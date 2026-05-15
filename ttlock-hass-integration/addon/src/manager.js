import EventEmitter from 'node:events';
import store from './store.js';
import { TTLockClient, AudioManage, LockedStatus, LogOperateCategory, LogOperateNames } from '@domodom30/ttlock-sdk-js';

const ScanType = Object.freeze({
  NONE: 0,
  AUTOMATIC: 1,
  MANUAL: 2
});

const SCAN_MAX = 3;

/**
 * Sleep for
 * @param ms miliseconds
 */
async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise
 * @param {number} ms timeout in milliseconds
 * @param {string} label label for error message
 */
function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('BLE timeout (' + label + ')')), ms))]);
}
/**
 * Events:
 * - lockListChanged - when a lock was found during scanning
 * - lockPaired - a lock was paired
 * - lockConnected - a connetion to a lock was estabilisehed
 * - lockLock - a lock was locked
 * - lockUnlock - a lock was unlocked
 * - scanStart - scanning has started
 * - scanStop - scanning has stopped
 */
class Manager extends EventEmitter {
  constructor() {
    super();
    this.startupStatus = -1;
    this.client = undefined;
    this.scanning = false;
    /** @type {NodeJS.Timeout} */
    this.scanTimer = undefined;
    this.scanCounter = 0;
    /** @type {Map<string, import('ttlock-sdk-js').TTLock>} Locks that are paired and were seen during the BLE scan */
    this.pairedLocks = new Map();
    /** @type {Map<string, import('ttlock-sdk-js').TTLock>} Locks that are pairable and were seen during the BLE scan */
    this.newLocks = new Map();
    /** @type {Map<string, import('ttlock-sdk-js').TTLock>} Locks found during scan that we need to connect to at least once to get their information */
    this.connectQueue = new Map();
    /** @type {Set<string>} Addresses of locks where a user operation is in progress */
    this.waitingForConnect = new Set();
    /** @type {Map<string, NodeJS.Timeout>} Pending/running retry timers keyed by address */
    this.connectRetryTimers = new Map();
    /** @type {Map<string, Promise<void>>} Per-lock BLE mutex tail (serializes BLE access on a given address) */
    this._bleMutex = new Map();
    /** @type {Map<string, () => void>} Active mutex release functions keyed by address — held between _connectLock and _releaseConnect */
    this._mutexReleases = new Map();
    /** @type {Map<string, boolean>} Last known audio (lockSound) status per lock — populated by successful BLE reads/writes */
    this._cachedAudio = new Map();
    /** @type {Map<string, number>} Last known autoLockTime per lock */
    this._cachedAutoLock = new Map();
    /** @type {Map<string, Promise<{passcodes: any, cards: any, fingers: any}>>} In-flight getCredentials promises — coalesces duplicate concurrent requests */
    this._pendingCredentials = new Map();
    /** @type {'none'|'noble'} */
    this.gateway = 'none';
    this.gateway_host = '';
    this.gateway_port = 0;
    this.gateway_key = '';
    this.gateway_user = '';
    this.gateway_pass = '';
    /**
     * Health of the link to the noble websocket gateway, surfaced to the UI.
     * 'n/a' when no gateway is configured (local BLE adapter), 'unknown' when
     * the SDK internals could not be reached to observe it.
     * @type {'n/a'|'connecting'|'connected'|'disconnected'|'unknown'}
     */
    this.gatewayStatus = 'n/a';
    /** @type {boolean} true once the gateway socket has opened at least once */
    this._gatewayEverConnected = false;
    /** @type {NodeJS.Timeout|undefined} debounce timer for monitor recovery */
    this._gatewayRecoveryTimer = undefined;
    /** @type {boolean} guard so the RWS listeners are attached only once */
    this._gatewayWatchdogAttached = false;
    /** @type {NodeJS.Timeout|undefined} periodic monitor-health watchdog */
    this._gatewayWatchdogInterval = undefined;
    /** @type {boolean} re-entrancy guard for _ensureMonitoring */
    this._ensuringMonitor = false;
  }

  async init() {
    if (this.client === undefined) {
      try {
        let clientOptions = {};

        if (this.gateway == 'noble') {
          clientOptions.scannerType = 'noble-websocket';
          clientOptions.scannerOptions = {
            websocketHost: this.gateway_host,
            websocketPort: this.gateway_port,
            websocketAesKey: this.gateway_key,
            websocketUsername: this.gateway_user,
            websocketPassword: this.gateway_pass
          };
        }

        this.client = new TTLockClient(clientOptions);
        this.updateClientLockDataFromStore();

        this.client.on('ready', () => {
          // Update startupStatus in case prepareBTService() timed out before BLE was ready
          if (this.startupStatus !== 0) {
            console.log('BLE adapter ready (delayed)');
            this.startupStatus = 0;
            this.emit('adapterReady');
          }
          this.client.startMonitor();
        });
        this.client.on('foundLock', this._onFoundLock.bind(this));
        this.client.on('scanStart', this._onScanStarted.bind(this));
        this.client.on('scanStop', this._onScanStopped.bind(this));
        // Transition guard: the BLE scanner can emit scanStart/scanStop more
        // than once per monitoring session (slow/flaky adapter bring-up), and
        // TTLockClient.onScanStart has no false→true guard. startMonitor() is
        // idempotent so this is purely cosmetic — collapse duplicates so the
        // log reflects real monitor state transitions only.
        this.client.on('monitorStart', () => {
          if (this._monitorActiveLogged) return;
          this._monitorActiveLogged = true;
          console.log('Monitor started');
        });
        this.client.on('monitorStop', () => {
          if (!this._monitorActiveLogged) return;
          this._monitorActiveLogged = false;
          console.log('Monitor stopped');
        });
        this.client.on('updatedLockData', this._onUpdatedLockData.bind(this));
        const adapterReady = await this.client.prepareBTService();
        if (!adapterReady) {
          console.warn('BLE adapter not ready within timeout — waiting for delayed ready event');
        }
        this.startupStatus = adapterReady ? 0 : 1;
        if (this.gateway === 'noble') {
          this._attachGatewayWatchdog();
        }
      } catch (error) {
        console.log(error);
        this.startupStatus = 1;
      }
    }
  }

  updateClientLockDataFromStore() {
    const lockData = store.getLockData();
    this.client.setLockData(Array.isArray(lockData) ? lockData : []);
  }

  setNobleGateway(gateway_host, gateway_port, gateway_key, gateway_user, gateway_pass) {
    this.gateway = 'noble';
    this.gateway_host = gateway_host;
    this.gateway_port = gateway_port;
    this.gateway_key = gateway_key;
    this.gateway_user = gateway_user;
    this.gateway_pass = gateway_pass;
    this.gatewayStatus = 'connecting';
  }

  getStartupStatus() {
    return this.startupStatus;
  }

  /**
   * Health of the noble websocket gateway link, for the status payload.
   * @returns {'n/a'|'connecting'|'connected'|'disconnected'|'unknown'}
   */
  getGatewayStatus() {
    return this.gatewayStatus;
  }

  /**
   * `host:port` of the configured noble gateway (for the UI tooltip), or '' in
   * local BLE mode.
   * @returns {string}
   */
  getGatewayHost() {
    return this.gateway === 'noble' ? `${this.gateway_host}:${this.gateway_port}` : '';
  }

  /**
   * @param {'n/a'|'connecting'|'connected'|'disconnected'|'unknown'} status
   */
  _setGatewayStatus(status) {
    if (this.gatewayStatus === status) return;
    this.gatewayStatus = status;
    console.log(`[Gateway] État du lien: ${status}`);
    this.emit('gatewayStatusChanged', status);
  }

  /**
   * Observe the gateway websocket connection so the UI can show its health and
   * so monitoring is re-armed after a reconnect.
   *
   * The SDK only emits `stateChange` once (on the very first connect), so a
   * later gateway drop is otherwise invisible: `startupStatus` stays 0, the
   * scan silently dies and the user gets no feedback. We reach the underlying
   * `reconnecting-websocket` through the SDK object graph and attach our own
   * open/close listeners. This is read-only/additive (it never alters SDK
   * behaviour) and fully feature-detected — if the SDK shape changes the
   * status degrades to 'unknown' instead of crashing.
   */
  _attachGatewayWatchdog() {
    if (this._gatewayWatchdogAttached) return;
    // TTLockClient → BluetoothLeService → NobleScannerWebsocket → Noble → binding → RWS
    const ws = this.client?.bleService?.scanner?.noble?._bindings?.ws;
    if (!ws || typeof ws.addEventListener !== 'function') {
      console.warn('[Gateway] Impossible d\'observer le socket du SDK (structure interne inattendue) — état du lien indisponible.');
      this._setGatewayStatus('unknown');
      return;
    }
    this._gatewayWatchdogAttached = true;

    // RWS readyState: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
    this._setGatewayStatus(ws.readyState === 1 ? 'connected' : 'connecting');
    if (ws.readyState === 1) this._gatewayEverConnected = true;

    ws.addEventListener('open', () => {
      const reconnect = this._gatewayEverConnected;
      this._gatewayEverConnected = true;
      this._setGatewayStatus('connected');
      // The SDK does NOT re-issue the scan command after a reconnect (it only
      // flushes its command buffer), and the freshly-rebooted gateway is not
      // scanning — so monitoring is dead until we restart it ourselves.
      if (reconnect) this._scheduleGatewayRecovery();
    });
    const onDown = () => {
      if (this.gatewayStatus !== 'disconnected') this._setGatewayStatus('disconnected');
    };
    ws.addEventListener('close', onDown);
    ws.addEventListener('error', onDown);

    // Safety net: lock-op-driven monitor cycling (and the silent-false
    // startMonitor() at _onScanStopped/_onLockDisconnected) can leave the
    // monitor off even while the gateway is up. A periodic check re-arms it
    // when the BLE path is idle, independently of the reconnect fast path.
    if (!this._gatewayWatchdogInterval) {
      this._gatewayWatchdogInterval = setInterval(() => {
        this._ensureMonitoring();
      }, 20000);
      if (typeof this._gatewayWatchdogInterval.unref === 'function') {
        this._gatewayWatchdogInterval.unref();
      }
    }
  }

  /**
   * Debounced fast path: re-arm the BLE monitor right after a gateway
   * reconnect (the periodic watchdog would otherwise pick it up within 20 s).
   */
  _scheduleGatewayRecovery() {
    if (this._gatewayRecoveryTimer) clearTimeout(this._gatewayRecoveryTimer);
    this._gatewayRecoveryTimer = setTimeout(() => {
      this._gatewayRecoveryTimer = undefined;
      this._ensureMonitoring();
    }, 2500);
  }

  /**
   * Block up to `ms` waiting for the noble gateway link to be connected.
   * Returns immediately true in local BLE mode (no gateway).
   * @param {number} ms
   * @returns {Promise<boolean>}
   */
  async _waitForGatewayReady(ms) {
    if (this.gateway !== 'noble') return true;
    const deadline = Date.now() + ms;
    while (this.gatewayStatus !== 'connected' && Date.now() < deadline) {
      await sleep(200);
    }
    return this.gatewayStatus === 'connected';
  }

  /**
   * Ensure the BLE monitor is actually running when the gateway is up and the
   * BLE path is idle.
   *
   * Why this is non-trivial: `TTLockClient.stopMonitor()` is a no-op when
   * `isMonitoring()` is already false (a lock op just stopped the scan) and it
   * never resets the internal `monitoring` flag, so a later `startMonitor()`
   * early-returns false forever — the monitor stays dead until a manual scan.
   * We detect that wedged state and clear the internal flags before retrying.
   * Reaching `client.monitoring/scanning` is internal coupling, but it is
   * feature-detected (typeof guard) and degrades to a no-op if the SDK shape
   * changes — never a crash.
   */
  async _ensureMonitoring() {
    if (this.gateway !== 'noble' || this.gatewayStatus !== 'connected') return;
    if (this._ensuringMonitor) return;
    // BLE path busy — the active flow (scan / lock op / queued connect)
    // restarts the monitor itself when it finishes.
    if (this.scanning || this.waitingForConnect.size > 0 || this.connectQueue.size > 0) return;
    if (this.client?.isMonitoring?.()) return;

    this._ensuringMonitor = true;
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (this.client.isMonitoring()) return;
        try {
          await this.client.stopMonitor();
        } catch (error) {
          console.debug('[Gateway] stopMonitor (best-effort) a échoué:', error.message);
        }
        // stopMonitor clears `monitoring` asynchronously via the scanStop event.
        let wait = 20;
        while (this.client.monitoring === true && !this.client.isMonitoring() && wait-- > 0) {
          await sleep(100);
        }
        // Wedged-flag escape hatch: stopMonitor no-op'd but `monitoring` is
        // still true while the scanner is not actually scanning.
        if (typeof this.client.monitoring === 'boolean' && !this.client.isMonitoring()) {
          this.client.monitoring = false;
          if (typeof this.client.scanning === 'boolean') this.client.scanning = false;
        }
        await this.client.startMonitor();
        let poll = 30;
        while (!this.client.isMonitoring() && poll-- > 0) {
          await sleep(100);
        }
        if (this.client.isMonitoring()) {
          console.log('[Gateway] Reconnecté — monitor BLE actif: true');
          return;
        }
        await sleep(attempt * 1000);
      }
      console.warn('[Gateway] Monitor BLE toujours inactif après reprise — nouvelle tentative au prochain cycle du watchdog.');
    } catch (error) {
      console.warn('[Gateway] Échec de la reprise du monitor:', error.message);
    } finally {
      this._ensuringMonitor = false;
    }
  }

  async startScan() {
    if (!this.scanning) {
      await this.client.stopMonitor();
      const res = await this.client.startScanLock();
      if (res) {
        this._scanTimer();
      }
      return res;
    }
    return false;
  }

  async stopScan() {
    if (this.scanning) {
      if (this.scanTimer !== undefined) {
        clearTimeout(this.scanTimer);
        this.scanTimer = undefined;
      }
      return await this.client.stopScanLock();
    }
    return false;
  }

  getIsScanning() {
    return this.scanning;
  }

  getPairedVisible() {
    return this.pairedLocks;
  }

  getNewVisible() {
    return this.newLocks;
  }

  getLastPasscodeError(address) {
    const lock = this.pairedLocks.get(address);
    return lock?.lastPasscodeError ?? null;
  }

  /**
   * Init a new lock
   * @param {string} address MAC address
   */
  async initLock(address) {
    const lock = this.newLocks.get(address);
    if (lock === undefined) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const res = await lock.initLock();
      if (res !== false) {
        this.pairedLocks.set(lock.getAddress(), lock);
        this.newLocks.delete(lock.getAddress());
        this._bindLockEvents(lock);
        // Persist deviceInfo (firmware, model, etc.) — getLockData() from the SDK doesn't include it
        if (lock.deviceInfo) {
          store.setDeviceInfo(lock.getAddress(), lock.deviceInfo);
        }
        this.emit('lockPaired', lock);
        return true;
      }
      return false;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async _tryUnlock(lock, address, attempt) {
    try {
      const res = await withTimeout(lock.unlock(), 15000, 'unlock ' + address);
      console.log('Unlock result for', address, ':', res);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      // The SDK swallows "Failed unlock response" (often a transient CRC corruption) and
      // returns false. Treat that as a soft-failure so the parent loop reconnects and retries.
      if (res === false) return { done: false };
      return { done: true, res };
    } catch (error) {
      console.error(`Unlock attempt ${attempt}/3 error:`, error.message);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      return { done: false };
    }
  }

  async unlockLock(address) {
    const lock = this.pairedLocks.get(address);
    if (lock === undefined) {
      console.log('Unlock: lock not in pairedLocks:', address);
      return false;
    }
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`Attempting unlock (${attempt}/3):`, address);
        if (!(await this._connectLock(lock))) {
          console.log(`Unlock: connect failed on attempt ${attempt}/3 for`, address);
          if (attempt < 3) {
            console.log(`Waiting ${attempt * 1.5}s before retry...`);
            await sleep(attempt * 1500);
            continue;
          }
          return false;
        }
        const { done, res } = await this._tryUnlock(lock, address, attempt);
        if (done) return res;
        if (attempt < 3) {
          this._releaseMutex(address);
          console.log(`Waiting ${attempt * 1.5}s before retry...`);
          await sleep(attempt * 1500);
        }
      }
      console.log('All unlock attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async _tryLock(lock, address, attempt) {
    try {
      const res = await withTimeout(lock.lock(), 15000, 'lock ' + address);
      console.log('Lock result for', address, ':', res);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      // The SDK swallows transient lock-command errors (CRC, bad response) and returns
      // false. Treat that as a soft-failure so the parent loop reconnects and retries.
      if (res === false) return { done: false };
      return { done: true, res };
    } catch (error) {
      console.error(`Lock attempt ${attempt}/3 error:`, error.message);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      return { done: false };
    }
  }

  async lockLock(address) {
    const lock = this.pairedLocks.get(address);
    if (lock === undefined) {
      console.log('Lock: lock not in pairedLocks:', address);
      return false;
    }
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`Attempting lock (${attempt}/3):`, address);
        if (!(await this._connectLock(lock))) {
          console.log(`Lock: connect failed on attempt ${attempt}/3 for`, address);
          if (attempt < 3) {
            console.log(`Waiting ${attempt * 1.5}s before retry...`);
            await sleep(attempt * 1500);
            continue;
          }
          return false;
        }
        const { done, res } = await this._tryLock(lock, address, attempt);
        if (done) return res;
        if (attempt < 3) {
          this._releaseMutex(address);
          console.log(`Waiting ${attempt * 1.5}s before retry...`);
          await sleep(attempt * 1500);
        }
      }
      console.log('All lock attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async _trySetAutoLock(lock, address, value, attempt) {
    try {
      const res = await withTimeout(lock.setAutoLockTime(value), 15000, 'setAutoLock ' + address);
      if (res !== false) this._cachedAutoLock.set(address, value);
      this.emit('lockUpdated', lock);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      // The SDK swallows transient errors and returns false. Treat that as a soft-failure
      // so the parent loop reconnects and retries.
      if (res === false) return { done: false };
      return { done: true, res };
    } catch (error) {
      console.error(`setAutoLock attempt ${attempt}/3 error:`, error.message);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      return { done: false };
    }
  }

  async setAutoLock(address, value) {
    const lock = this.pairedLocks.get(address);
    if (lock === undefined) return false;
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (!(await this._connectLock(lock))) {
          if (attempt < 3) {
            await sleep(5000);
            continue;
          }
          return false;
        }
        const { done, res } = await this._trySetAutoLock(lock, address, value, attempt);
        if (done) return res;
        if (attempt < 3) {
          this._releaseMutex(address);
          await sleep(5000);
        }
      }
      console.log('All setAutoLock attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async getCredentials(address) {
    // Coalesce concurrent requests: if a fetch is already in progress for this
    // address (e.g. user clicked twice, or frontend retried), return the same
    // promise instead of starting a competing BLE session that saturates the radio.
    if (this._pendingCredentials.has(address)) {
      console.log('getCredentials already in progress for', address, '— reusing pending request');
      return this._pendingCredentials.get(address);
    }
    const promise = this._doGetCredentials(address);
    this._pendingCredentials.set(address, promise);
    try {
      return await promise;
    } finally {
      this._pendingCredentials.delete(address);
    }
  }

  async _doGetCredentials(address) {
    const lock = this.pairedLocks.get(address);
    if (lock === undefined) {
      return { passcodes: false, cards: false, fingers: false };
    }

    const MAX_READ_ATTEMPTS = 3;

    // Acquire the BLE mutex ONCE for all retry attempts.
    // Releasing and re-acquiring between retries causes _releaseConnect to restart
    // the monitor, which then must be stopped again before reconnecting — this
    // BLE scan cycle adds 3-5s of latency and makes the retry unreliable.
    if (!(await this._connectLock(lock))) {
      return { passcodes: false, cards: false, fingers: false };
    }

    try {
      for (let readAttempt = 1; readAttempt <= MAX_READ_ATTEMPTS; readAttempt++) {
        // On retry: disconnect, reset adminAuth, wait, reconnect (mutex already held)
        if (readAttempt > 1) {
          console.warn(`getCredentials: retrying reads (attempt ${readAttempt}/${MAX_READ_ATTEMPTS})`);
          if (lock.adminAuth !== undefined) lock.adminAuth = false;
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          await sleep(1500);
          let reconnected = false;
          for (let attempt = 1; attempt <= 4; attempt++) {
            if (lock.isConnected() && lock.adminAuth) {
              reconnected = true;
              break;
            }
            const result = await this._connectAttempt(lock, address, true, attempt);
            if (result === true) {
              reconnected = true;
              break;
            }
            if (attempt < 4) await sleep(attempt * 1500);
          }
          if (!reconnected) {
            console.error('getCredentials: reconnect failed on retry', readAttempt);
            return { passcodes: false, cards: false, fingers: false };
          }
        }

        const passcodes = lock.hasPassCode()
          ? await withTimeout(lock.getPassCodes(), 20000, 'getPassCodes ' + address).catch((e) => {
              console.error('getPassCodes:', e.message);
              return false;
            })
          : false;
        const cardsRaw = lock.hasICCard()
          ? await withTimeout(lock.getICCards(), 20000, 'getICCards ' + address).catch((e) => {
              console.error('getICCards:', e.message);
              return false;
            })
          : false;
        let cards = cardsRaw;
        if (Array.isArray(cardsRaw)) {
          for (const card of cardsRaw) card.alias = store.getCardAlias(card.cardNumber);
        }
        const fingersRaw = lock.hasFingerprint()
          ? await withTimeout(lock.getFingerprints(), 20000, 'getFingerprints ' + address).catch((e) => {
              console.error('getFingerprints:', e.message);
              return false;
            })
          : false;
        let fingers = fingersRaw;
        if (Array.isArray(fingersRaw)) {
          for (const f of fingersRaw) f.alias = store.getFingerAlias(f.fpNumber);
        }

        const allFailed = (lock.hasPassCode() ? passcodes === false : false) || (lock.hasICCard() ? cardsRaw === false : false) || (lock.hasFingerprint() ? fingersRaw === false : false);

        if (!allFailed || readAttempt >= MAX_READ_ATTEMPTS) {
          return { passcodes, cards, fingers };
        }

        console.warn(`getCredentials: all reads failed (attempt ${readAttempt}/${MAX_READ_ATTEMPTS}) — will retry`);
      }
      return { passcodes: false, cards: false, fingers: false };
    } finally {
      // Single release covers all retry attempts — monitor restarts once here
      this._releaseConnect(address);
    }
  }

  async addPasscode(address, type, passCode, startDate, endDate) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasPassCode()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      console.log('[diag] addPasscode params', {
        type,
        passCode,
        startDate,
        endDate,
        passCodeLen: passCode?.length,
        connected: lock.isConnected()
      });
      let existing = null;
      try {
        existing = await lock.getPassCodes();
        console.log('[diag] existing passcodes count:', Array.isArray(existing) ? existing.length : existing);
        if (Array.isArray(existing)) {
          const dup = existing.find((p) => String(p.newPassCode) === String(passCode));
          if (dup) console.warn('[diag] duplicate detected before add:', dup);
        }
      } catch (e) {
        console.warn('[diag] pre-add getPassCodes failed:', e.message);
      }
      console.log('addPasscode → addPassCode', { type, passCode });

      const ok = await lock.addPassCode(type, passCode, startDate, endDate);
      if (!ok) {
        const detail = lock.lastPasscodeError;
        console.error('[diag] addPassCode rejected by lock:', detail ? detail.message : '(no detail — likely admin login or BLE issue)', 'connected:', lock.isConnected());
        return false;
      }

      // Give the firmware time to persist the new passcode before reading back.
      // Without this delay getPassCodes returns an empty list immediately after the write.
      await sleep(1500);

      for (let readAttempt = 1; readAttempt <= 3; readAttempt++) {
        if (!lock.isConnected()) {
          console.warn(`addPasscode: lock disconnected after write — reconnecting for getPassCodes (attempt ${readAttempt}/3)`);
          if (lock.adminAuth !== undefined) lock.adminAuth = false;
          await sleep(1000);
          let reconnected = false;
          for (let attempt = 1; attempt <= 4; attempt++) {
            const result = await this._connectAttempt(lock, address, true, attempt);
            if (result === true) {
              reconnected = true;
              break;
            }
            if (attempt < 4) await sleep(attempt * 1500);
          }
          if (!reconnected) {
            console.error('addPasscode: reconnect failed — cannot refresh passcode list');
            return null;
          }
        }
        try {
          const passcodes = await withTimeout(lock.getPassCodes(), 15000, 'getPassCodes after add ' + address);
          console.log('[diag] getPassCodes after add:', Array.isArray(passcodes) ? passcodes.length : passcodes);
          // Firmware index not ready yet — wait and retry rather than sending empty list to UI
          if (Array.isArray(passcodes) && passcodes.length === 0 && readAttempt < 3) {
            console.warn(`addPasscode: getPassCodes returned empty (attempt ${readAttempt}/3) — retrying`);
            await sleep(2000);
            continue;
          }
          return passcodes;
        } catch (e) {
          console.warn(`addPasscode: getPassCodes attempt ${readAttempt}/3 failed:`, e.message);
          if (readAttempt >= 3) {
            console.error('addPasscode: all getPassCodes retries exhausted — returning null');
            return null;
          }
          await sleep(2000);
        }
      }
      return null;
    } catch (error) {
      console.error('addPasscode error:', error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async updatePasscode(address, type, oldPasscode, newPasscode, startDate, endDate) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasPassCode()) return false;
    if (!oldPasscode || !newPasscode || !startDate || !endDate) {
      console.error('updatePasscode: missing required parameters', { type, oldPasscode, newPasscode, startDate, endDate });
      return false;
    }
    if (!(await this._connectLock(lock))) return false;
    try {
      console.log('updatePasscode → updatePassCode', { type, oldPasscode, newPasscode });
      const ok = await lock.updatePassCode(type, oldPasscode, newPasscode, startDate, endDate);
      if (!ok) {
        const detail = lock.lastPasscodeError;
        if (detail) console.error('updatePasscode rejected by lock:', detail.message);
        return false;
      }
      return await lock.getPassCodes();
    } catch (error) {
      console.error('updatePasscode error:', error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async deletePasscode(address, type, passCode) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasPassCode()) return false;
    let deleteSucceeded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!(await this._connectLock(lock))) return deleteSucceeded ? null : false;
      try {
        if (!deleteSucceeded) {
          console.log(`deletePasscode attempt ${attempt}/3 — delete`, { type, passCode });
          const ok = await lock.deletePassCode(type, passCode);
          console.log('deletePassCode result:', ok);
          if (!ok) {
            const detail = lock.lastPasscodeError;
            if (detail) console.error('deletePasscode rejected by lock:', detail.message);
            if (!lock.isConnected() && attempt < 3) {
              console.warn('deletePasscode: disconnect during delete — retrying');
              continue;
            }
            return false;
          }
          deleteSucceeded = true;
        }
        console.log(`deletePasscode attempt ${attempt}/3 — getPassCodes`);
        const passcodes = await lock.getPassCodes().catch((e) => {
          console.error('deletePasscode getPassCodes:', e.message);
          return false;
        });
        if (passcodes === false) {
          if (attempt < 3) {
            console.warn('deletePasscode: getPassCodes failed — retrying');
            continue;
          }
          // delete ok but couldn't refresh list — caller will re-fetch
          return null;
        }
        return passcodes;
      } catch (error) {
        console.error('deletePasscode error:', error);
        if (!lock.isConnected() && attempt < 3) continue;
        return deleteSucceeded ? null : false;
      } finally {
        this._releaseConnect(address);
      }
    }
    return deleteSucceeded ? null : false;
  }

  async addCard(address, startDate, endDate, alias) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasICCard()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const card = await lock.addICCard(startDate, endDate);
      if (!card) return false;
      store.setCardAlias(card, alias);
      const cards = await lock.getICCards();
      for (const c of cards) c.alias = store.getCardAlias(c.cardNumber);
      return cards;
    } catch (error) {
      console.error('addCard error:', error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async updateCard(address, card, startDate, endDate, alias) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasICCard()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const ok = await lock.updateICCard(card, startDate, endDate);
      if (!ok && ok !== '') return false;
      store.setCardAlias(card, alias);
      const cards = await lock.getICCards();
      for (const c of cards) c.alias = store.getCardAlias(c.cardNumber);
      return cards;
    } catch (error) {
      console.error('updateCard error:', error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async deleteCard(address, card) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasICCard()) return false;
    let deleteSucceeded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!(await this._connectLock(lock))) return deleteSucceeded ? null : false;
      try {
        if (!deleteSucceeded) {
          console.log(`deleteCard attempt ${attempt}/3 — delete`, { card });
          const ok = await lock.deleteICCard(card);
          console.log('deleteICCard result:', ok);
          if (!ok) {
            if (!lock.isConnected() && attempt < 3) {
              console.warn('deleteCard: disconnect during delete — retrying');
              continue;
            }
            return false;
          }
          store.deleteCardAlias(card);
          deleteSucceeded = true;
        }
        console.log(`deleteCard attempt ${attempt}/3 — getICCards`);
        const cards = await lock.getICCards().catch((e) => {
          console.error('deleteCard getICCards:', e.message);
          return false;
        });
        if (cards === false) {
          if (attempt < 3) {
            console.warn('deleteCard: getICCards failed — retrying');
            continue;
          }
          return null;
        }
        if (Array.isArray(cards)) {
          for (const c of cards) c.alias = store.getCardAlias(c.cardNumber);
        }
        return cards;
      } catch (error) {
        console.error('deleteCard error:', error);
        if (!lock.isConnected() && attempt < 3) continue;
        return deleteSucceeded ? null : false;
      } finally {
        this._releaseConnect(address);
      }
    }
    return deleteSucceeded ? null : false;
  }

  async addFinger(address, startDate, endDate, alias) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasFingerprint()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const finger = await lock.addFingerprint(startDate, endDate);
      if (!finger) return false;
      store.setFingerAlias(finger, alias);
      const fingers = await lock.getFingerprints();
      for (const f of fingers) f.alias = store.getFingerAlias(f.fpNumber);
      return fingers;
    } catch (error) {
      console.error('addFinger error:', error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async updateFinger(address, finger, startDate, endDate, alias) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasFingerprint()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const ok = await lock.updateFingerprint(finger, startDate, endDate);
      if (!ok && ok !== '') return false;
      store.setFingerAlias(finger, alias);
      const fingers = await lock.getFingerprints();
      for (const f of fingers) f.alias = store.getFingerAlias(f.fpNumber);
      return fingers;
    } catch (error) {
      console.error('updateFinger error:', error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async deleteFinger(address, finger) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasFingerprint()) return false;
    let deleteSucceeded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!(await this._connectLock(lock))) return deleteSucceeded ? null : false;
      try {
        if (!deleteSucceeded) {
          console.log(`deleteFinger attempt ${attempt}/3 — delete`, { finger });
          const ok = await lock.deleteFingerprint(finger);
          console.log('deleteFingerprint result:', ok);
          if (!ok) {
            if (!lock.isConnected() && attempt < 3) {
              console.warn('deleteFinger: disconnect during delete — retrying');
              continue;
            }
            return false;
          }
          store.deleteFingerAlias(finger);
          deleteSucceeded = true;
        }
        console.log(`deleteFinger attempt ${attempt}/3 — getFingerprints`);
        const fingers = await lock.getFingerprints().catch((e) => {
          console.error('deleteFinger getFingerprints:', e.message);
          return false;
        });
        if (fingers === false) {
          if (attempt < 3) {
            console.warn('deleteFinger: getFingerprints failed — retrying');
            continue;
          }
          return null;
        }
        if (Array.isArray(fingers)) {
          for (const f of fingers) f.alias = store.getFingerAlias(f.fpNumber);
        }
        return fingers;
      } catch (error) {
        console.error('deleteFinger error:', error);
        if (!lock.isConnected() && attempt < 3) continue;
        return deleteSucceeded ? null : false;
      } finally {
        this._releaseConnect(address);
      }
    }
    return deleteSucceeded ? null : false;
  }

  async _trySetAudio(lock, address, audio, attempt) {
    try {
      const sound = audio ? AudioManage.TURN_ON : AudioManage.TURN_OFF;
      const res = await withTimeout(lock.setLockSound(sound), 15000, 'setAudio ' + address);
      if (res !== false) this._cachedAudio.set(address, audio);
      this.emit('lockUpdated', lock);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      // The SDK swallows transient errors and returns false. Treat that as a soft-failure
      // so the parent loop reconnects and retries.
      if (res === false) return { done: false };
      return { done: true, res };
    } catch (error) {
      console.error(`setAudio attempt ${attempt}/3 error:`, error.message);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      return { done: false };
    }
  }

  async setAudio(address, audio) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasLockSound()) return false;
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (!(await this._connectLock(lock))) {
          if (attempt < 3) {
            await sleep(5000);
            continue;
          }
          return false;
        }
        const { done, res } = await this._trySetAudio(lock, address, audio, attempt);
        if (done) return res;
        if (attempt < 3) {
          this._releaseMutex(address);
          await sleep(5000);
        }
      }
      console.log('All setAudio attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async _tryCalibrateTime(lock, address, attempt) {
    try {
      // COMM_TIME_CALIBRATE requires an authenticated admin session — without it the
      // firmware returns FAILED + errorCode=0x02 (ERROR_NO_PERMISSION). The admin login
      // must happen as part of the connect handshake (via _connectLock(lock, true) in
      // calibrateTime), not after the connection is established.
      await withTimeout(lock.calibrateTimeCommand(), 10000, 'calibrateTimeCommand ' + address);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      return { done: true, res: true };
    } catch (error) {
      console.error(`calibrateTime attempt ${attempt}/3 error:`, error.message);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      return { done: false };
    }
  }

  async calibrateTime(address) {
    const lock = this.pairedLocks.get(address);
    if (lock === undefined) return false;
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        // needsAdmin=true: the lock rejects COMM_TIME_CALIBRATE with ERROR_NO_PERMISSION
        // unless the session is admin-authenticated. Doing the admin login in the connect
        // handshake (rather than after) is the only way that succeeds reliably — a separate
        // macro_adminLogin call after _connectLock(false) gets "No response to checkAdmin".
        if (!(await this._connectLock(lock, true))) {
          if (attempt < 3) {
            await sleep(5000);
            continue;
          }
          return false;
        }
        const { done, res } = await this._tryCalibrateTime(lock, address, attempt);
        if (done) return res;
        if (attempt < 3) {
          this._releaseMutex(address);
          await sleep(5000);
        }
      }
      console.log('All calibrateTime attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async _tryGetAudio(lock, address, attempt) {
    try {
      const sound = await withTimeout(lock.getLockSound(true), 15000, 'getAudio ' + address);
      const audio = sound === AudioManage.TURN_ON;
      if (sound === AudioManage.TURN_ON || sound === AudioManage.TURN_OFF) {
        this._cachedAudio.set(address, audio);
      }
      this.emit('lockUpdated', lock);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      return { done: true, res: audio };
    } catch (error) {
      console.error(`getAudio attempt ${attempt}/3 error:`, error.message);
      if (lock.isConnected()) await lock.disconnect().catch(() => {});
      return { done: false };
    }
  }

  async getAudio(address) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasLockSound()) return false;
    // Manager-level cache (populated by previous reads/writes) — no BLE, no mutex.
    if (this._cachedAudio.has(address)) return this._cachedAudio.get(address);
    // Cache empty: connect and read from lock (mutex held via _connectLock)
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (!(await this._connectLock(lock, false))) {
          // getLockSound needs no adminAuth
          if (attempt < 3) {
            await sleep(5000);
            continue;
          }
          return false;
        }
        const { done, res } = await this._tryGetAudio(lock, address, attempt);
        if (done) return res;
        if (attempt < 3) {
          this._releaseMutex(address);
          await sleep(5000);
        }
      }
      console.log('All getAudio attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  _enrichOperation(operation) {
    operation.recordTypeName = LogOperateNames[operation.recordType];
    if (LogOperateCategory.LOCK.includes(operation.recordType)) {
      operation.recordTypeCategory = 'LOCK';
    } else if (LogOperateCategory.UNLOCK.includes(operation.recordType)) {
      operation.recordTypeCategory = 'UNLOCK';
    } else if (LogOperateCategory.FAILED.includes(operation.recordType)) {
      operation.recordTypeCategory = 'FAILED';
    } else {
      operation.recordTypeCategory = 'OTHER';
    }
    if (operation.password !== undefined) {
      if (LogOperateCategory.IC.includes(operation.recordType)) {
        operation.passwordName = store.getCardAlias(operation.password);
      } else if (LogOperateCategory.FINGERPRINT.includes(operation.recordType)) {
        operation.passwordName = store.getFingerAlias(operation.password);
      }
    }
    return operation;
  }

  /**
   * Journal d'opérations persisté dans lockData.json, sans aucune connexion BLE.
   * Cloné avant enrichissement pour ne pas polluer store.lockData (saveData()
   * réécrirait sinon recordTypeName/recordTypeCategory/passwordName sur disque).
   * @param {string} address
   * @returns {Array}
   */
  getPersistedOperationLog(address) {
    const entry = store.getLockData().find((e) => e && e.address === address);
    if (!entry || !Array.isArray(entry.operationLog)) return [];
    return entry.operationLog
      .filter(Boolean)
      .map((op) => this._enrichOperation(structuredClone(op)));
  }

  async getOperationLog(address, reload = false) {
    const lock = this.pairedLocks.get(address);
    if (lock === undefined) return false;
    if (!(await this._connectLock(lock, false))) {
      return false;
    }
    try {
      // Force the SDK's 0xffff fetch path (new events) so a manual refresh always pulls
      // fresh entries. Keep noCache=false so the cache is merged — passing noCache=true
      // makes the SDK re-fetch from sequence 0 (dozens of BLE round-trips, unreliable).
      if (reload) lock.newEvents = true;
      // Do NOT wrap in withTimeout: a full all=true sweep on a cold cache is
      // dozens–hundreds of BLE round-trips and legitimately exceeds any fixed
      // cap. The SDK loop is already bounded (maxRetry, failedSequences>10 stop,
      // probe, `if(!isConnected) break`). Wrapping also leaked the still-running
      // SDK promise while the finally released the mutex → "Command already in
      // progress" — same reason connect() is never wrapped in this file.
      const startedAt = Date.now();
      console.log('getOperationLog: starting full fetch for', address, reload ? '(reload)' : '');
      const operations = structuredClone(await lock.getOperationLog(true, false));
      console.log(`getOperationLog: ${operations.filter(Boolean).length} entries for ${address} in ${Date.now() - startedAt}ms`);
      return operations.filter(Boolean).map((op) => this._enrichOperation(op));
    } catch (error) {
      console.error(`getOperationLog error:`, error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async resetLock(address) {
    const lock = this.pairedLocks.get(address);
    if (lock === undefined) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const res = await lock.resetLock();
      if (res) {
        lock.removeAllListeners();
        this.pairedLocks.delete(address);
        this.emit('lockUnpaired', lock);
        this.emit('lockListChanged');
      }
      return res;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  /**
   * Acquire the per-address BLE mutex. Returns a release function. Callers must
   * always invoke the release function (typically via try/finally), even on error.
   * @param {string} address
   * @returns {Promise<() => void>}
   */
  async _acquireMutex(address) {
    while (this._bleMutex.has(address)) {
      try {
        await this._bleMutex.get(address);
      } catch (err) {
        // The promise stored in _bleMutex was rejected (e.g. the holder threw).
        // Swallow the rejection — we just need to re-check if the mutex is free.
        console.debug('_acquireMutex: mutex promise rejected, retrying', err);
      }
    }
    let release;
    const promise = new Promise((r) => (release = r));
    this._bleMutex.set(address, promise);
    return () => {
      if (this._bleMutex.get(address) === promise) {
        this._bleMutex.delete(address);
      }
      release();
    };
  }

  /**
   * True if a BLE op is currently in flight on this lock (mutex held).
   * @param {string} address
   */
  isLockBusy(address) {
    return this._bleMutex.has(address) || this.waitingForConnect.has(address);
  }

  getCachedAudio(address) {
    return this._cachedAudio.get(address);
  }

  getCachedAutoLock(address) {
    return this._cachedAutoLock.get(address);
  }

  /**
   * Wait for an in-progress BLE connect to finish before attempting our own.
   * @param {import('ttlock-sdk-js').TTLock} lock
   * @param {string} address
   * @returns {Promise<boolean>} true if already connected after waiting
   */
  async _waitForConnecting(lock, address) {
    if (!lock.connecting) return false;
    console.log('Connect in progress, waiting for', address);
    let wait = 200; // 20s max
    while (lock.connecting && wait > 0) {
      await sleep(100);
      wait--;
    }
    return lock.isConnected();
  }

  /**
   * Run macro_adminLogin after a successful connect(false).
   * @param {import('ttlock-sdk-js').TTLock} lock
   * @param {string} address
   * @param {number} attempt current attempt number (1–3)
   * @returns {Promise<'ok'|'retry'|'abort'>}
   */
  async _doAdminLogin(lock, address, attempt) {
    // Do NOT add any sleep here: every ms we wait reduces the chance of hitting
    // the firmware's auth acceptance window. The 50 ms yield in _connectAttempt
    // (before calling us) is already enough to flush stale disconnect events.
    // Send checkAdminCommand immediately while the BLE radio is still warm.
    if (!lock.isConnected()) {
      console.warn('Lock already disconnected before macro_adminLogin', address, '— retrying connect');
      return attempt < 4 ? 'retry' : 'abort';
    }
    // SDK default (3 retries × 200 ms): some lock firmwares need 1-2 round-trips before
    // checkAdmin stabilises (random challenge regeneration). maxRetries=1 was too aggressive
    // and broke add/delete passcode on locks with marginal BLE — keep the full SDK budget
    // and rely on `_doAdminLogin` returning 'retry' for cross-connect recovery.
    const adminOk = await lock.macro_adminLogin().catch((e) => {
      console.warn('macro_adminLogin failed:', e.message);
      return false;
    });
    if (!adminOk && !lock.isConnected()) {
      // Lock disconnected during admin login — treat as connect failure and retry.
      console.warn('macro_adminLogin disconnected lock', address, '— retrying connect');
      return attempt < 4 ? 'retry' : 'abort';
    }
    if (!adminOk) {
      // Without adminAuth the credential reads will fail anyway — retry with a fresh BLE
      // session. With maxRetries=1 (above) the loop is bounded: 4 connect attempts × 1 admin
      // retry = 4 attempts per _connectLock, which is enough to absorb a flaky BLE link
      // without exploding into the 36-attempt avalanche the SDK default produces.
      console.warn('macro_adminLogin returned false for', address, '— retrying connect');
      return attempt < 4 ? 'retry' : 'abort';
    }
    return 'ok';
  }

  /**
   * Perform one connect(false) attempt, including optional admin login.
   * @param {import('ttlock-sdk-js').TTLock} lock
   * @param {string} address
   * @param {boolean} needsAdmin
   * @param {number} attempt current attempt number (1–3)
   * @returns {Promise<true|'retry'|false>}
   */
  async _connectAttempt(lock, address, needsAdmin, attempt) {
    try {
      console.log(`Connect attempt ${attempt}/4 to ${address}`);
      const res = await withTimeout(lock.connect(false), 15000, 'connect ' + address);
      if (!res) {
        if (lock.connecting) {
          let wait = 30;
          while (lock.connecting && wait > 0) {
            await sleep(100);
            wait--;
          }
        }
        console.log(`Connect attempt ${attempt}/4 failed (returned false)`);
        return false;
      }
      console.log('Connected to', address);
      await sleep(50);
      if (!lock.isConnected()) {
        console.warn('Lock self-disconnected right after onConnected', address, '— retrying');
        return attempt < 4 ? 'retry' : false;
      }
      if (needsAdmin) {
        // Always reset adminAuth: the SDK's internal macro_adminLogin sets
        // lock.adminAuth=true during connect(false)/onConnected even when the
        // firmware session is not actually valid (e.g. after a dropped mid-auth).
        // Skipping _doAdminLogin on a stale session causes every write/read
        // command to fail with NO_PERMISSION (code=0x01).
        lock.adminAuth = false;
        const adminResult = await this._doAdminLogin(lock, address, attempt);
        if (adminResult === 'retry') {
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          return 'retry';
        }
        if (adminResult === 'abort') return false;
      }
      if (!lock.isConnected()) {
        console.warn('Lock disconnected just after adminLogin', address, '— retrying');
        return attempt < 4 ? 'retry' : false;
      }
      return true;
    } catch (error) {
      console.error(`Connect attempt ${attempt}/4 error:`, error.message);
      // Reset so the next attempt doesn't skip macro_adminLogin on a stale session
      if (lock.adminAuth !== undefined) lock.adminAuth = false;
      return false;
    }
  }

  /**
   * Stop the BLE scan and wait up to 3 s for it to settle.
   * @returns {Promise<boolean>} true if scan stopped, false if it timed out.
   */
  async _stopScanForOp() {
    console.log('Stopping BLE scan for user op');
    await this.stopScan();
    let wait = 30;
    while (this.scanning && wait-- > 0) await sleep(100);
    if (this.scanning) {
      console.warn('BLE scan did not stop in time');
      return false;
    }
    return true;
  }

  /**
   * @param {import('ttlock-sdk-js').TTLock} lock
   * @param {boolean} [needsAdmin=true] - Whether this operation requires macro_adminLogin.
   *   Pass false for read-only operations (getOperationLog, calibrateTime) that work
   *   without admin auth — avoids an unnecessary checkAdminCommand that causes some lock
   *   firmware to disconnect immediately after the connect(false) handshake.
   */
  async _connectLock(lock, needsAdmin = true) {
    const address = lock.getAddress();
    // Cancel any pending background retry (initial connect(false) loop) so that a user
    // operation is never delayed indefinitely by a retrying connect(false) that holds the
    // mutex for 5-15 s per attempt.  After cancellation we still call _acquireMutex below
    // which will wait for any *currently-running* retry's connect(false) to finish and
    // release the mutex before we proceed — that is safe because the retry checks
    // connectQueue.has(address) AFTER releasing the mutex, so our delete below ensures it
    // won't reschedule itself once we take over.
    if (this.connectRetryTimers.has(address)) {
      clearTimeout(this.connectRetryTimers.get(address));
      this.connectRetryTimers.delete(address);
    }
    // Remove from connectQueue so that _onLockDisconnected / _scheduleRetry won't
    // reschedule a retry once the mutex is ours.
    this.connectQueue.delete(address);
    // Fail-fast: with a noble gateway down, every BLE command resolves to
    // "Disconnected while waiting for response". Hammering 4 attempts ×
    // backoff per op is pure noise and delays recovery — wait briefly for the
    // link, then give up cleanly (no mutex held yet → safe early return).
    if (this.gateway === 'noble' && this.gatewayStatus === 'disconnected') {
      if (!(await this._waitForGatewayReady(6000))) {
        console.warn(`Gateway noble déconnecté — connexion à ${address} abandonnée (réessai automatique à la reconnexion).`);
        return false;
      }
    }
    // Serialize all BLE ops on this lock — without this, parallel user ops collide
    // on the same BLE session and the SDK rejects them with "Command already in progress".
    const release = await this._acquireMutex(address);
    this._mutexReleases.set(address, release);
    this.waitingForConnect.add(address);
    if (this.scanning) {
      if (!(await this._stopScanForOp())) {
        this.waitingForConnect.delete(address);
        this._releaseMutex(address);
        return false;
      }
    }
    // Reuse the existing session only if it satisfies the admin requirement — a connected
    // but non-admin session is unusable for credential reads (the SDK will spin up its own
    // macro_adminLogin internally and fail the same way).
    if (lock.isConnected() && (!needsAdmin || lock.adminAuth)) return true;
    if ((await this._waitForConnecting(lock, address)) && (!needsAdmin || lock.adminAuth)) return true;
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (lock.isConnected() && (!needsAdmin || lock.adminAuth)) return true;
      // Gateway dropped mid-loop — remaining attempts are doomed, bail early.
      if (this.gateway === 'noble' && this.gatewayStatus === 'disconnected') {
        console.warn(`Gateway noble déconnecté pendant la connexion à ${address} — arrêt des tentatives.`);
        break;
      }
      const result = await this._connectAttempt(lock, address, needsAdmin, attempt);
      if (result === true) return true;
      // Exponential-ish back-off: 1.5 s, 3 s, 4.5 s between retries.
      if (attempt < 4) await sleep(attempt * 1500);
    }
    console.log('All connect attempts failed for', address);
    this.waitingForConnect.delete(address);
    // Release the mutex so a caller-side retry loop can re-acquire it without deadlocking.
    // _releaseConnect (called from caller's finally) will then no-op for this address.
    this._releaseMutex(address);
    return false;
  }

  /**
   * Release the per-address mutex if held. Idempotent — safe to call multiple times.
   * @param {string} address
   */
  _releaseMutex(address) {
    const release = this._mutexReleases.get(address);
    if (release) {
      this._mutexReleases.delete(address);
      release();
    }
  }

  // Called by every user operation in a finally block to release the waitingForConnect
  // guard and restart the monitor if the lock has already disconnected.
  _releaseConnect(address) {
    this.waitingForConnect.delete(address);
    if (!this.scanning) {
      const lock = this.pairedLocks.get(address);
      if (lock) {
        if (!lock.isConnected()) {
          this.client.startMonitor();
        }
        this.emit('lockUpdated', lock);
      }
    }
    // Release mutex last so that any handler triggered by lockUpdated (e.g. sendLockStatus)
    // sees the lock as still busy — they should fall back to cache instead of issuing BLE.
    this._releaseMutex(address);
  }

  async _onScanStarted() {
    this.scanning = true;
    console.log('BLE Scan started');
    this.emit('scanStart');
  }

  async _onScanStopped() {
    this.scanning = false;
    console.log('BLE Scan stopped');
    console.log('Refreshing paired locks');
    if (this.connectQueue.size > 0) {
      await sleep(1000); // wait for BLE stack to settle after scan stop
    }
    for (let [address, lock] of this.connectQueue) {
      console.log('Auto connect to', address);
      // Hold the per-lock BLE mutex so this background connect doesn't race with a
      // user op that fires the moment scanning=false flips.
      const release = await this._acquireMutex(address);
      try {
        // connect(false) to read device features (firmware, autoLock, passCode, etc.).
        // No withTimeout here: the SDK has internal disconnect handling that resolves the
        // promise. Wrapping with withTimeout would let the mutex be released while the SDK
        // is still pushing BLE commands, causing "Command already in progress" on the next
        // connect attempt.
        const result = await lock.connect(false);
        if (result === true) {
          // Remove from connectQueue BEFORE disconnecting so _onLockDisconnected
          // can call startMonitor() correctly
          this.connectQueue.delete(address);
          if (lock.isConnected() && !this.waitingForConnect.has(address)) {
            await lock.disconnect();
          }
          console.log('Successful connect attempt to paired lock', address);
        } else {
          console.log('Unsuccessful connect attempt to paired lock', address);
          // lock stays in connectQueue for next retry
        }
      } finally {
        release();
      }
    }

    this.emit('scanStop');
    setTimeout(() => {
      this.client.startMonitor();
    }, 200);
  }

  /**
   * Handle the initial BLE connect for a newly-discovered paired lock (while monitoring).
   * Adds to connectQueue, acquires mutex, connects(false), then processes or disconnects.
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _connectPairedLockOnFound(lock) {
    // Add to connectQueue BEFORE connecting so _onLockDisconnected sees it
    // if the disconnect event fires during the connect attempt
    this.connectQueue.set(lock.getAddress(), lock);
    // Hold the per-lock BLE mutex during the initial connect so user-op connects
    // don't race with us on the same BLE session.
    const release = await this._acquireMutex(lock.getAddress());
    try {
      // connect(false) = full connect: reads firmware, features (autoLock, passCode, etc.)
      // The lock may self-disconnect after searchDeviceFeatureCommand — handle both cases.
      // No withTimeout: the SDK has its own disconnect handling. Wrapping in withTimeout
      // releases the mutex while the SDK still has commands in flight, which causes
      // "Command already in progress" on the next connect.
      const result = await lock.connect(false);
      if (result === true) {
        console.log('Successful connect attempt to paired lock', lock.getAddress());
        this.connectQueue.delete(lock.getAddress());
        if (lock.isConnected()) {
          if (this.waitingForConnect.has(lock.getAddress())) {
            // connect(false) may have left corrupted session (e.g. failed checkRandom)
            // Force disconnect so _connectLock gets a fresh session via connect(true)
            await lock.disconnect().catch(() => {});
          } else {
            // No user operation waiting: process log and disconnect normally
            await this._processOperationLog(lock);
            await lock.disconnect();
          }
        }
        // else: lock self-disconnected after feature scan (normal TTLock behavior)
        // _onLockDisconnected will restart monitor
        // _onLockUpdated will read operation log on next advertisement change
      } else {
        console.log('Unsuccessful connect attempt to paired lock', lock.getAddress());
        // lock stays in connectQueue for retry on next scan
      }
    } finally {
      release();
    }
  }

  /**
   * Register and optionally connect a newly-seen paired lock.
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _handlePairedLockDiscovered(lock) {
    this._bindLockEvents(lock);
    // add it to the list of known locks immediately to prevent infinite retry loop
    this.pairedLocks.set(lock.getAddress(), lock);
    console.log('Discovered paired lock:', lock.getAddress());
    if (this.client.isMonitoring()) {
      await sleep(1000); // wait for BLE stack to settle before connecting
      await this._connectPairedLockOnFound(lock);
    } else {
      // add it to the connect queue for later
      this.connectQueue.set(lock.getAddress(), lock);
    }
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onFoundLock(lock) {
    let listChanged = false;
    if (lock.isPaired()) {
      if (!this.pairedLocks.has(lock.getAddress())) {
        await this._handlePairedLockDiscovered(lock);
        listChanged = true;
      }
    } else if (lock.isInitialized()) {
      console.log('Discovered unknown lock:', lock.toJSON());
    } else if (!this.newLocks.has(lock.getAddress())) {
      // check if lock is in pairing mode
      // add it to the list of new locks, ready to be initialized
      console.log('Discovered new lock:', lock.toJSON());
      this.newLocks.set(lock.getAddress(), lock);
      listChanged = true;
      if (this.client.isScanning()) {
        console.log('New lock found, stopping scan');
        await this.stopScan();
      }
    }
    if (listChanged) this.emit('lockListChanged');
  }

  async _onUpdatedLockData() {
    store.setLockData(this.client.getLockData());
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  _bindLockEvents(lock) {
    lock.on('connected', this._onLockConnected.bind(this));
    lock.on('disconnected', this._onLockDisconnected.bind(this));
    lock.on('locked', this._onLockLocked.bind(this));
    lock.on('unlocked', this._onLockUnlocked.bind(this));
    lock.on('updated', this._onLockUpdated.bind(this));
    lock.on('scanICStart', () => this.emit('lockCardScan', lock));
    lock.on('scanFRStart', () => this.emit('lockFingerScan', lock));
    lock.on('scanFRProgress', () => this.emit('lockFingerScanProgress', lock));
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockConnected(lock) {
    if (lock.isPaired()) {
      this.pairedLocks.set(lock.getAddress(), lock);
      console.log('Connected to paired lock ' + lock.getAddress());
      // One-time migration: persist deviceInfo if not yet stored (locks paired before v1.4.0)
      // Only run during initial monitor connects — NOT during user operations (would cause
      // concurrent BLE reads since emit() is synchronous but _onLockConnected is async)
      if (!this.waitingForConnect.has(lock.getAddress()) && !store.getDeviceInfo(lock.getAddress())) {
        try {
          const deviceInfo = await lock.macro_readAllDeviceInfo();
          if (deviceInfo) {
            lock.deviceInfo = deviceInfo;
            store.setDeviceInfo(lock.getAddress(), deviceInfo);
            console.log('Persisted deviceInfo (migration) for', lock.getAddress(), ':', deviceInfo.firmwareRevision);
          }
        } catch (err) {
          console.error('Failed to read deviceInfo for', lock.getAddress(), ':', err.message);
        }
      }
      this.emit('lockConnected', lock);
    } else {
      console.log('Connected to new lock ' + lock.getAddress());
    }
  }

  /**
   * Schedule a connect(false) retry for a lock still in connectQueue.
   * Deduplication: if a timer is already pending/running for this address, does nothing.
   * On failure, reschedules itself so the lock eventually completes initialization.
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  _scheduleRetry(lock) {
    const address = lock.getAddress();
    if (this.connectRetryTimers.has(address)) return;
    console.log('Initial connect failed for', address, '— retrying connect in 5s');
    const handle = setTimeout(async () => {
      console.log('Retrying initial connect for', address);
      // Hold the per-lock BLE mutex while retrying so we don't race with user ops.
      const release = await this._acquireMutex(address);
      let result = false;
      try {
        // No withTimeout: the SDK has internal disconnect handling. Wrapping releases the
        // mutex while BLE commands are still in flight → "Command already in progress" later.
        result = await lock.connect(false);
        this.connectRetryTimers.delete(address);
        if (result) {
          console.log('Retry connect succeeded for', address);
          this.connectQueue.delete(address);
          if (lock.isConnected() && !this.waitingForConnect.has(address)) {
            await this._processOperationLog(lock);
            await lock.disconnect().catch(() => {});
          }
        } else {
          console.log('Retry connect failed for', address);
          // If _onLockDisconnected fired during connect(false) it was blocked by the
          // dedup guard — reschedule explicitly so the lock eventually initializes.
          if (this.connectQueue.has(address)) {
            this._scheduleRetry(lock);
          }
        }
      } finally {
        release();
      }
    }, 5000);
    this.connectRetryTimers.set(address, handle);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockDisconnected(lock) {
    console.log('Disconnected from lock ' + lock.getAddress());
    const address = lock.getAddress();
    if (this.waitingForConnect.has(address)) {
      // A user operation is in progress — do not restart monitor, _releaseConnect handles it.
      return;
    }
    if (this.connectQueue.has(address)) {
      if (this.connectRetryTimers.has(address)) {
        // Retry already scheduled or running — ignore duplicate disconnect event
        return;
      }
      this._scheduleRetry(lock);
      return;
    }
    // If the BLE mutex is held, a user operation is waiting to acquire it (e.g. _connectLock
    // deleted connectQueue before getting the mutex, so the connectQueue check above is false).
    // Do NOT start the monitor here — _releaseConnect will restart it once the op completes.
    if (this._bleMutex.has(address)) {
      return;
    }
    // Normal disconnect after a user operation: restart monitor immediately.
    this.client.startMonitor();
    // Push a status update so the UI receives cached autoLockTime/audio now that
    // the lock is idle (Lock.fromTTLock skips BLE reads when isConnected==true).
    this.emit('lockUpdated', lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockLocked(lock) {
    this.emit('lockLock', lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockUnlocked(lock) {
    this.emit('lockUnlock', lock);
  }

  /**
   * Handle the newEvents branch of _onLockUpdated.
   * Connects (skipDataRead=true), reads the operation log, then disconnects.
   * Includes cooldown guard and deferred-reset timer to avoid BLE spam.
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _handleNewEventsUpdate(lock) {
    // The TTLock SDK emits paramsChanged.newEvents=true only on a false→true transition of
    // lock.newEvents. If we set lock.newEvents=false ourselves the SDK will re-emit on the
    // very next advertisement (false→true again) causing an infinite spam loop.
    // Strategy: never set lock.newEvents=false here except after a failed connect where we
    // genuinely want a retry on the next ad. For cooldown/busy paths we schedule a deferred
    // reset so the retry happens after the cooldown expires rather than immediately.
    const OPLOG_COOLDOWN_MS = 60 * 1000;
    if (lock._lastOperationLogFetch && Date.now() - lock._lastOperationLogFetch < OPLOG_COOLDOWN_MS) {
      // Still within cooldown — don't reconnect, don't touch lock.newEvents (avoid spam loop).
      // Schedule a one-shot reset so we retry once the cooldown expires.
      if (!lock._newEventsResetTimer) {
        const remaining = OPLOG_COOLDOWN_MS - (Date.now() - lock._lastOperationLogFetch);
        lock._newEventsResetTimer = setTimeout(() => {
          lock._newEventsResetTimer = null;
          lock.newEvents = false; // triggers re-emit on next advertisement → retry
        }, remaining);
      }
      return;
    }
    // If lock is already connected / busy: do nothing. The ongoing operation will call
    // _processOperationLog or disconnect, which sets lock._lastOperationLogFetch and the
    // normal cooldown path will take over. Don't touch lock.newEvents here (avoids spam).
    if (lock.isConnected() || lock._processingOperationLog || this.waitingForConnect.has(lock.getAddress())) return;
    // Cancel any pending deferred reset — we are about to process now
    if (lock._newEventsResetTimer) {
      clearTimeout(lock._newEventsResetTimer);
      lock._newEventsResetTimer = null;
    }
    // Hold the BLE mutex during this background read so we don't race with user ops.
    const release = await this._acquireMutex(lock.getAddress());
    let weConnected = false;
    try {
      // withTimeout: a wedged connect(true) here would hold the mutex indefinitely and
      // freeze every user op (delete passcode, unlock, …) on _acquireMutex. The finally
      // block below force-disconnects on timeout, which clears the SDK's pending-command
      // state so the next connect doesn't trip "Command already in progress".
      const result = await withTimeout(lock.connect(true), 15000, 'newEventsConnect ' + lock.getAddress()).catch((e) => {
        console.warn('_onLockUpdated connect timed out:', e.message);
        return false;
      });
      if (!result) {
        lock.newEvents = false; // connect failed — allow retry on next advertisement
        return;
      }
      weConnected = true;
      await this._processOperationLog(lock);
    } catch (error) {
      // lock.connect() can throw "NobleDevice is not connected" if BLE disconnects
      // during readBasicInfo(). Swallow it here — _onLockUpdated is called via EventEmitter
      // and has no awaiter, so any unhandled rejection becomes an uncaughtException.
      console.error('_onLockUpdated connect/process error:', error.message);
      lock.newEvents = false; // connect failed — allow retry on next advertisement
    } finally {
      // Disconnect inside the mutex so the next user op gets a clean session — this also
      // serves as the cleanup path for the withTimeout above (forces SDK to drop any
      // pending commands left over from a stalled connect).
      if (lock.isConnected()) {
        await lock.disconnect().catch(() => {});
      }
      release();
    }
  }

  /**
   * Handle the lockedStatus branch of _onLockUpdated.
   * Emits lockLock/lockUnlock based on current or cached lock status.
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _handleLockedStatusUpdate(lock) {
    // Only call getLockStatus() if already connected (it may try to connect otherwise).
    // When not connected, rely on the cached status from the advertisement.
    if (lock.isConnected()) {
      const status = await lock.getLockStatus();
      if (status == LockedStatus.LOCKED) {
        this.emit('lockLock', lock);
      } else if (status == LockedStatus.UNLOCKED) {
        this.emit('lockUnlock', lock);
      }
    } else {
      // Use cached status from BLE advertisement (no connection needed)
      const status = lock.getLockStatus();
      if (status == LockedStatus.LOCKED) {
        this.emit('lockLock', lock);
      } else if (status == LockedStatus.UNLOCKED) {
        this.emit('lockUnlock', lock);
      }
    }
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockUpdated(lock, paramsChanged) {
    console.log('lockUpdated', paramsChanged);
    if (paramsChanged.newEvents === true && lock.hasNewEvents()) {
      await this._handleNewEventsUpdate(lock);
    }
    if (paramsChanged.lockedStatus === true) {
      await this._handleLockedStatusUpdate(lock);
    }
    if (paramsChanged.batteryCapacity === true) {
      this.emit('lockUpdated', lock);
      this.emit('lockBatteryUpdated', lock);
    }
    // Connect/disconnect for the newEvents branch is handled inside _handleNewEventsUpdate.
  }

  async _processOperationLog(lock) {
    // Prevent concurrent executions for the same lock
    if (lock._processingOperationLog) return;
    lock._processingOperationLog = true;
    try {
      let operations = await lock.getOperationLog();
      lock.newEvents = false;
      lock._lastOperationLogFetch = Date.now();
      if (!Array.isArray(operations)) return;
      let lastStatus = LockedStatus.UNKNOWN;
      for (let op of operations) {
        if (LogOperateCategory.UNLOCK.includes(op.recordType)) {
          lastStatus = LockedStatus.UNLOCKED;
          this.emit('lockUnlock', lock);
        } else if (LogOperateCategory.LOCK.includes(op.recordType)) {
          lastStatus = LockedStatus.LOCKED;
          this.emit('lockLock', lock);
        }
      }
      const status = await lock.getLockStatus();
      if (lastStatus != LockedStatus.UNKNOWN && status != lastStatus) {
        if (status == LockedStatus.LOCKED) {
          this.emit('lockLock', lock);
        } else if (status == LockedStatus.UNLOCKED) {
          this.emit('lockUnlock', lock);
        }
      }
    } catch (error) {
      console.error('_processOperationLog error:', error.message);
      // Reset newEvents so the next advertisement doesn't immediately re-enter this path.
      // Also stamp _lastOperationLogFetch so the cooldown guard fires for 60s —
      // prevents a tight retry loop when the lock keeps disconnecting during the fetch.
      lock.newEvents = false;
      lock._lastOperationLogFetch = Date.now();
    } finally {
      lock._processingOperationLog = false;
    }
  }

  /** Stop scan after 30 seconds */
  async _scanTimer() {
    if (this.scanTimer === undefined) {
      this.scanTimer = setTimeout(() => {
        this.stopScan();
      }, 30 * 1000);
    }
  }
}

const manager = new Manager();

export default manager;
