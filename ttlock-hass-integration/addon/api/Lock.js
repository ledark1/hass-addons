'use strict';

const { AudioManage } = require('ttlock-sdk-js');
const store = require('../src/store');

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
    if (!lockObject.isConnected()) {
      // Only do BLE reads when the lock is idle — avoids racing with user operations.
      try {
        lock.autoLockTime = await lockObject.getAutolockTime();
      } catch (error) {
        // not yet available
      }
    }
    // getLockSound uses in-memory cache (no BLE) — safe to call even when connected
    try {
      const sound = await lockObject.getLockSound();
      if (sound !== AudioManage.UNKNOWN) {
        lock.audio = sound === AudioManage.TURN_ON;
      }
      // If UNKNOWN, leave lock.audio as undefined — chip won't show in UI
    } catch (error) {
      // not yet available (cache empty and not connected)
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