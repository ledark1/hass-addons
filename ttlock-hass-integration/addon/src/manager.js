'use strict';

const EventEmitter = require('events');
const store = require('./store');
const { TTLockClient, AudioManage, LockedStatus, LogOperateCategory, LogOperateNames } = require('ttlock-sdk-js');

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
    /** @type {'none'|'noble'} */
    this.gateway = 'none';
    this.gateway_host = '';
    this.gateway_port = 0;
    this.gateway_key = '';
    this.gateway_user = '';
    this.gateway_pass = '';
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
        this.client.on('monitorStart', () => console.log('Monitor started'));
        this.client.on('monitorStop', () => console.log('Monitor stopped'));
        this.client.on('updatedLockData', this._onUpdatedLockData.bind(this));
        const adapterReady = await this.client.prepareBTService();
        if (!adapterReady) {
          console.warn('BLE adapter not ready within timeout — waiting for delayed ready event');
        }
        this.startupStatus = adapterReady ? 0 : 1;
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
  }

  getStartupStatus() {
    return this.startupStatus;
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

  /**
   * Init a new lock
   * @param {string} address MAC address
   */
  async initLock(address) {
    const lock = this.newLocks.get(address);
    if (lock === undefined) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      let res = await lock.initLock();
      if (res != false) {
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
            console.log('Waiting 5s before retry...');
            await sleep(5000);
            continue;
          }
          return false;
        }
        try {
          const res = await withTimeout(lock.unlock(), 15000, 'unlock ' + address);
          console.log('Unlock result for', address, ':', res);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          return res;
        } catch (error) {
          console.error(`Unlock attempt ${attempt}/3 error:`, error.message);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          if (attempt < 3) {
            console.log('Waiting 5s before retry...');
            await sleep(5000);
          }
        }
      }
      console.log('All unlock attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
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
            console.log('Waiting 5s before retry...');
            await sleep(5000);
            continue;
          }
          return false;
        }
        try {
          const res = await withTimeout(lock.lock(), 15000, 'lock ' + address);
          console.log('Lock result for', address, ':', res);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          return res;
        } catch (error) {
          console.error(`Lock attempt ${attempt}/3 error:`, error.message);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          if (attempt < 3) {
            console.log('Waiting 5s before retry...');
            await sleep(5000);
          }
        }
      }
      console.log('All lock attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
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
        try {
          const res = await withTimeout(lock.setAutoLockTime(value), 15000, 'setAutoLock ' + address);
          this.emit('lockUpdated', lock);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          return res;
        } catch (error) {
          console.error(`setAutoLock attempt ${attempt}/3 error:`, error.message);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          if (attempt < 3) await sleep(5000);
        }
      }
      console.log('All setAutoLock attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async getCredentials(address) {
    const passcodes = await this.getPasscodes(address);
    const cards = await this.getCards(address);
    const fingers = await this.getFingers(address);
    return {
      passcodes: passcodes,
      cards: cards,
      fingers: fingers
    };
  }

  async addPasscode(address, type, passCode, startDate, endDate) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasPassCode()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      return await lock.addPassCode(type, passCode, startDate, endDate);
    } catch (error) {
      console.error(error);
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
      return await lock.updatePassCode(type, oldPasscode, newPasscode, startDate, endDate);
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async deletePasscode(address, type, passCode) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasPassCode()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      return await lock.deletePassCode(type, passCode);
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async getPasscodes(address) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasPassCode()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      return await lock.getPassCodes();
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async addCard(address, startDate, endDate, alias) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasICCard()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const card = await lock.addICCard(startDate, endDate);
      store.setCardAlias(card, alias);
      return card;
    } catch (error) {
      console.error(error);
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
      const result = await lock.updateICCard(card, startDate, endDate);
      store.setCardAlias(card, alias);
      return result;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async deleteCard(address, card) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasICCard()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const result = await lock.deleteICCard(card);
      store.deleteCardAlias(card);
      return result;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async getCards(address) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasICCard()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const cards = await lock.getICCards();
      for (const card of cards) {
        card.alias = store.getCardAlias(card.cardNumber);
      }
      return cards;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async addFinger(address, startDate, endDate, alias) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasFingerprint()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const finger = await lock.addFingerprint(startDate, endDate);
      store.setFingerAlias(finger, alias);
      return finger;
    } catch (error) {
      console.error(error);
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
      const result = await lock.updateFingerprint(finger, startDate, endDate);
      store.setFingerAlias(finger, alias);
      return result;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async deleteFinger(address, finger) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasFingerprint()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const result = await lock.deleteFingerprint(finger);
      store.deleteFingerAlias(finger);
      return result;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async getFingers(address) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasFingerprint()) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      const fingers = await lock.getFingerprints();
      for (const finger of fingers) {
        finger.alias = store.getFingerAlias(finger.fpNumber);
      }
      return fingers;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      this._releaseConnect(address);
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
        try {
          const sound = audio ? AudioManage.TURN_ON : AudioManage.TURN_OFF;
          const res = await withTimeout(lock.setLockSound(sound), 15000, 'setAudio ' + address);
          this.emit('lockUpdated', lock);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          return res;
        } catch (error) {
          console.error(`setAudio attempt ${attempt}/3 error:`, error.message);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          if (attempt < 3) await sleep(5000);
        }
      }
      console.log('All setAudio attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async calibrateTime(address) {
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
        try {
          const res = await withTimeout(lock.calibrateTime(), 15000, 'calibrateTime ' + address);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          return res;
        } catch (error) {
          console.error(`calibrateTime attempt ${attempt}/3 error:`, error.message);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          if (attempt < 3) await sleep(5000);
        }
      }
      console.log('All calibrateTime attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async getAudio(address) {
    const lock = this.pairedLocks.get(address);
    if (!lock?.hasLockSound()) return false;
    // Try cached value first (populated during initial connect(false))
    try {
      const cached = await lock.getLockSound();
      if (cached === AudioManage.TURN_ON || cached === AudioManage.TURN_OFF) {
        return cached === AudioManage.TURN_ON;
      }
    } catch (error) {
      console.error('Error reading cached audio value for', address, ':', error.message);
    }
    // Cache empty: connect and read from lock
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (!(await this._connectLock(lock))) {
          if (attempt < 3) {
            await sleep(5000);
            continue;
          }
          return false;
        }
        try {
          const sound = await withTimeout(lock.getLockSound(true), 15000, 'getAudio ' + address);
          this.emit('lockUpdated', lock);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          return sound === AudioManage.TURN_ON;
        } catch (error) {
          console.error(`getAudio attempt ${attempt}/3 error:`, error.message);
          if (lock.isConnected()) await lock.disconnect().catch(() => {});
          if (attempt < 3) await sleep(5000);
        }
      }
      console.log('All getAudio attempts failed for', address);
      return false;
    } finally {
      this._releaseConnect(address);
    }
  }

  async getOperationLog(address, reload = false) {
    const lock = this.pairedLocks.get(address);
    if (lock === undefined) return false;
    if (!(await this._connectLock(lock))) return false;
    try {
      // When reload is requested, force newEvents=true so the SDK always fetches
      // new events from the lock (sequence 0xffff) before returning the merged log.
      // Without this, if the monitor hasn't seen the lock since startup,
      // newEvents stays false and only the cached (old) operationLog is returned.
      if (reload) {
        lock.newEvents = true;
      }
      let operations = JSON.parse(JSON.stringify(await lock.getOperationLog(true, false)));
      return operations.filter(Boolean).map((operation) => {
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
          } else if (LogOperateCategory.FR.includes(operation.recordType)) {
            operation.passwordName = store.getFingerAlias(operation.password);
          }
        }
        return operation;
      });
    } catch (error) {
      console.error(error);
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
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   * @param {boolean} readData
   */
  async _connectLock(lock) {
    const address = lock.getAddress();
    this.waitingForConnect.add(address);
    if (this.scanning) {
      this.waitingForConnect.delete(address);
      return false;
    }
    if (lock.isConnected()) return true;
    // Wait for any in-progress connect to finish (avoids "Connect already in progress")
    if (lock.connecting) {
      console.log('Connect in progress, waiting for', address);
      let wait = 200; // 20s max
      while (lock.connecting && wait > 0) {
        await sleep(100);
        wait--;
      }
      if (lock.isConnected()) return true;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (lock.isConnected()) return true;
      try {
        console.log(`Connect attempt ${attempt}/3 to ${address}`);
        // skipDataRead=true: skip searchDeviceFeatureCommand which disconnects this lock
        const res = await withTimeout(lock.connect(true), 15000, 'connect ' + address);
        if (res) {
          console.log('Connected to', address);
          return true;
        }
        console.log(`Connect attempt ${attempt}/3 failed (returned false)`);
      } catch (error) {
        console.error(`Connect attempt ${attempt}/3 error:`, error.message);
      }
      if (attempt < 3) await sleep(2000);
    }
    console.log('All connect attempts failed for', address);
    this.waitingForConnect.delete(address);
    return false;
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
      // connect(false) to read device features (firmware, autoLock, passCode, etc.)
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
    }

    this.emit('scanStop');
    setTimeout(() => {
      this.client.startMonitor();
    }, 200);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onFoundLock(lock) {
    let listChanged = false;
    if (lock.isPaired()) {
      // check if lock is known
      if (!this.pairedLocks.has(lock.getAddress())) {
        this._bindLockEvents(lock);
        // add it to the list of known locks immediately to prevent infinite retry loop
        this.pairedLocks.set(lock.getAddress(), lock);
        console.log('Discovered paired lock:', lock.getAddress());
        if (this.client.isMonitoring()) {
          await sleep(1000); // wait for BLE stack to settle before connecting
          // Add to connectQueue BEFORE connecting so _onLockDisconnected sees it
          // if the disconnect event fires during the connect attempt
          this.connectQueue.set(lock.getAddress(), lock);
          // connect(false) = full connect: reads firmware, features (autoLock, passCode, etc.)
          // The lock may self-disconnect after searchDeviceFeatureCommand — handle both cases
          const result = await lock.connect(false);
          if (result == true) {
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
        } else {
          // add it to the connect queue
          this.connectQueue.set(lock.getAddress(), lock);
        }
        listChanged = true;
      }
    } else if (!lock.isInitialized()) {
      if (!this.newLocks.has(lock.getAddress())) {
        // this._bindLockEvents(lock);
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
    } else {
      console.log('Discovered unknown lock:', lock.toJSON());
    }

    if (listChanged) {
      this.emit('lockListChanged');
    }
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
      const result = await lock.connect(false);
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
    }, 5000);
    this.connectRetryTimers.set(address, handle);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockDisconnected(lock) {
    console.log('Disconnected from lock ' + lock.getAddress());
    if (this.waitingForConnect.has(lock.getAddress())) {
      // A user operation is in progress — do not restart monitor, _releaseConnect handles it.
      return;
    }
    if (this.connectQueue.has(lock.getAddress())) {
      if (this.connectRetryTimers.has(lock.getAddress())) {
        // Retry already scheduled or running — ignore duplicate disconnect event
        return;
      }
      this._scheduleRetry(lock);
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
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockUpdated(lock, paramsChanged) {
    console.log('lockUpdated', paramsChanged);
    let weConnected = false;

    // if lock has new operations read the operations and send updates
    if (paramsChanged.newEvents == true && lock.hasNewEvents()) {
      if (!lock.isConnected() && !lock._processingOperationLog && !this.waitingForConnect.has(lock.getAddress())) {
        const result = await lock.connect(true); // skipDataRead=true
        if (!result) {
          lock.newEvents = false; // allow re-detection on next advertisement
          return;
        }
        weConnected = true;
      }
      if (weConnected) {
        await this._processOperationLog(lock);
      } else {
        // lock already connected or operation in progress — reset so next advertisement can re-trigger
        lock.newEvents = false;
      }
    }
    if (paramsChanged.lockedStatus == true) {
      // paramsChanged.lockedStatus means the BLE advertisement contains a status update.
      // Only call getLockStatus() if already connected (it may try to connect otherwise).
      // When not connected, rely on the cached status from the advertisement.
      if (lock.isConnected()) {
        const status = await lock.getLockStatus();
        if (status == LockedStatus.LOCKED) {
          console.log('>>>>>> Lock is now locked from new event <<<<<<');
          this.emit('lockLock', lock);
        } else if (status == LockedStatus.UNLOCKED) {
          console.log('>>>>>> Lock is now unlocked from new event <<<<<<');
          this.emit('lockUnlock', lock);
        }
      } else {
        // Use cached status from BLE advertisement (no connection needed)
        const status = lock.getLockStatus();
        if (status == LockedStatus.LOCKED) {
          console.log('>>>>>> Lock is now locked from advertisement <<<<<<');
          this.emit('lockLock', lock);
        } else if (status == LockedStatus.UNLOCKED) {
          console.log('>>>>>> Lock is now unlocked from advertisement <<<<<<');
          this.emit('lockUnlock', lock);
        }
      }
    }
    if (paramsChanged.batteryCapacity == true) {
      this.emit('lockUpdated', lock);
      this.emit('lockBatteryUpdated', lock);
    }

    // Only disconnect if we initiated the connection — avoids racing with user operations
    if (weConnected) {
      await lock.disconnect();
    }
  }

  async _processOperationLog(lock) {
    // Prevent concurrent executions for the same lock
    if (lock._processingOperationLog) return;
    lock._processingOperationLog = true;
    try {
      let operations = await lock.getOperationLog();
      lock.newEvents = false;
      if (!Array.isArray(operations)) return;
      let lastStatus = LockedStatus.UNKNOWN;
      for (let op of operations) {
        if (LogOperateCategory.UNLOCK.includes(op.recordType)) {
          lastStatus = LockedStatus.UNLOCKED;
          console.log('>>>>>> Lock was unlocked <<<<<<');
          this.emit('lockUnlock', lock);
        } else if (LogOperateCategory.LOCK.includes(op.recordType)) {
          lastStatus = LockedStatus.LOCKED;
          console.log('>>>>>> Lock was locked <<<<<<');
          this.emit('lockLock', lock);
        }
      }
      const status = await lock.getLockStatus();
      if (lastStatus != LockedStatus.UNKNOWN && status != lastStatus) {
        if (status == LockedStatus.LOCKED) {
          console.log('>>>>>> Lock is now locked <<<<<<');
          this.emit('lockLock', lock);
        } else if (status == LockedStatus.UNLOCKED) {
          console.log('>>>>>> Lock is now unlocked <<<<<<');
          this.emit('lockUnlock', lock);
        }
      }
    } catch (error) {
      console.error('_processOperationLog error:', error.message);
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

module.exports = manager;
