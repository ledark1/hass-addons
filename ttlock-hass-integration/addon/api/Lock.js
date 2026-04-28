'use strict';

const { AudioManage } = require('ttlock-sdk-js');
const store = require('../src/store');
const manager = require('../src/manager');

class Lock {
  /** @type {string} MAC address */
  address;
  /** @type {number} Signal strength */
  rssi;
  /** @type {number} Battery level */
  battery;
  /** @type {string} Assigned name */
  name;
  /** @type {boolean} If the lock is paired or not */
  paired;
  /** @type {boolean} If the lock is connected or not */
  connected;
  /** @type {import('ttlock-sdk-js').LockedStatus} If the lock is locked or not, -1 unknown, 0 locked, 1 unlocked */
  locked;
  /** @type {number} The number of seconds the lock will auto lock after being unlocked */
  autoLockTime;
  /** @type {boolean} If the lock's audio is enabled or not */
  audio;
  /** @type {boolean} If the lock has auto-lock feature */
  hasAutoLock;
  /** @type {boolean} If the lock has a keypad and supports passcodes (PIN) */
  hasPasscode;
  /** @type {boolean} If the lock has card reader support */
  hasCard;
  /** @type {boolean} If the lock has fingerprint reader support */
  hasFinger;
  /** @type {boolean} If the lock has audio management */
  hasAudio;
  /** @type {string} Lock model */
  model;
  /** @type {string} Firmware version */
  firmware;
  /** @type {string} Manufacturer */
  manufacturer;

  /**
   * 
   * @param {import('ttlock-sdk-js').TTLock} lockObject 
   */
  static async fromTTLock(lockObject) {
    const lock = new Lock();

    lock.address = lockObject.getAddress();
    lock.name = lockObject.getName();
    lock.paired = lockObject.isPaired();
    lock.connected = lockObject.isConnected();
    lock.rssi = lockObject.getRssi();
    lock.battery = lockObject.getBattery();
    try {
      // getLockStatus with noCache=false just returns this.lockedStatus — no BLE
      lock.locked = await lockObject.getLockStatus();
    } catch (error) {
      // lock in pairing mode
    }
    // STRICTLY non-BLE from here on: this method runs on every status broadcast and must
    // NEVER touch the BLE bus, otherwise it races with user ops (=> "Command already in progress").
    // Use the Manager's in-memory caches, populated by successful read/write operations.
    const cachedAutoLock = manager.getCachedAutoLock(lock.address);
    if (cachedAutoLock !== undefined) {
      lock.autoLockTime = cachedAutoLock;
    } else if (!lockObject.isConnected() && !manager.isLockBusy(lock.address)) {
      // SDK getter returns the cached value without BLE when one exists (set during initial
      // connect(false)). When no cached value exists yet the SDK falls back to BLE — guard
      // against that with the busy check above.
      try {
        lock.autoLockTime = await lockObject.getAutolockTime();
      } catch (error) {
        // not yet available
      }
    }
    const cachedAudio = manager.getCachedAudio(lock.address);
    if (cachedAudio !== undefined) {
      lock.audio = cachedAudio;
    } else if (!manager.isLockBusy(lock.address)) {
      // SDK returns the cached AudioManage value without BLE when one exists; only call when
      // the lock is idle to avoid an opportunistic BLE write that would collide with user ops.
      try {
        const sound = await lockObject.getLockSound();
        if (sound === AudioManage.TURN_ON || sound === AudioManage.TURN_OFF) {
          lock.audio = sound === AudioManage.TURN_ON;
        }
      } catch (error) {
        // not yet available (cache empty and not connected)
      }
    }
    lock.hasAutoLock = lockObject.hasAutolock();
    lock.hasPasscode = lockObject.hasPassCode();
    lock.hasCard = lockObject.hasICCard();
    lock.hasFinger = lockObject.hasFingerprint();
    lock.hasAudio = lockObject.hasLockSound();
    // deviceInfo is only populated during initLock() (pairing) and not persisted by the SDK.
    // Fall back to the store's persisted copy, then to the live object.
    const deviceInfo = lockObject.deviceInfo || store.getDeviceInfo(lockObject.getAddress());
    const model = lockObject.getModel();
    lock.model = (model && model !== "unknown") ? model : (deviceInfo?.modelNum || "");
    const firmware = lockObject.getFirmware();
    lock.firmware = (firmware && firmware !== "unknown") ? firmware : (deviceInfo?.firmwareRevision || "");
    const manufacturer = lockObject.getManufacturer();
    lock.manufacturer = (manufacturer && manufacturer !== "unknown") ? manufacturer : "";

    return lock;
  }
}

module.exports = Lock;