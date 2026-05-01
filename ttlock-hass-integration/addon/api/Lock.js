import { AudioManage } from '@domodom30/ttlock-sdk-js';
import store from '../src/store.js';
import manager from '../src/manager.js';

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
   * @param {import('ttlock-sdk-js').TTLock} lockObject
   * @param {string} address
   * @returns {Promise<number|undefined>}
   */
  static async _resolveAutoLockTime(lockObject, address) {
    const cached = manager.getCachedAutoLock(address);
    if (cached !== undefined) return cached;
    if (lockObject.isConnected() || manager.isLockBusy(address)) return undefined;
    try {
      return await lockObject.getAutolockTime();
    } catch {
      return undefined;
    }
  }

  /**
   * @param {import('ttlock-sdk-js').TTLock} lockObject
   * @param {string} address
   * @returns {Promise<boolean|undefined>}
   */
  static async _resolveAudio(lockObject, address) {
    const cached = manager.getCachedAudio(address);
    if (cached !== undefined) return cached;
    if (manager.isLockBusy(address)) return undefined;
    try {
      const sound = await lockObject.getLockSound();
      if (sound === AudioManage.TURN_ON || sound === AudioManage.TURN_OFF) {
        return sound === AudioManage.TURN_ON;
      }
    } catch {
      // not yet available
    }
    return undefined;
  }

  /**
   * @param {import('ttlock-sdk-js').TTLock} lockObject
   * @param {string} address
   * @returns {{ model: string, firmware: string, manufacturer: string }}
   */
  static _resolveDeviceInfo(lockObject, address) {
    const deviceInfo = lockObject.deviceInfo || store.getDeviceInfo(address);
    const model = lockObject.getModel();
    const firmware = lockObject.getFirmware();
    const manufacturer = lockObject.getManufacturer();
    return {
      model: model && model !== 'unknown' ? model : deviceInfo?.modelNum || '',
      firmware: firmware && firmware !== 'unknown' ? firmware : deviceInfo?.firmwareRevision || '',
      manufacturer: manufacturer && manufacturer !== 'unknown' ? manufacturer : ''
    };
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lockObject
   */
  static async fromTTLock(lockObject) {
    const lock = new Lock();

    lock.address = lockObject.getAddress();
    lock.name = lockObject.getName() || lock.address;
    lock.paired = lockObject.isPaired();
    lock.connected = lockObject.isConnected();
    lock.rssi = lockObject.getRssi();
    lock.battery = lockObject.getBattery();

    try {
      lock.locked = await lockObject.getLockStatus();
    } catch {
      // lock in pairing mode
    }

    // STRICTLY non-BLE from here on: this method runs on every status broadcast and must
    // NEVER touch the BLE bus, otherwise it races with user ops (=> "Command already in progress").
    lock.autoLockTime = await Lock._resolveAutoLockTime(lockObject, lock.address);
    lock.audio = await Lock._resolveAudio(lockObject, lock.address);

    lock.hasAutoLock = lockObject.hasAutolock();
    lock.hasPasscode = lockObject.hasPassCode();
    lock.hasCard = lockObject.hasICCard();
    lock.hasFinger = lockObject.hasFingerprint();
    lock.hasAudio = lockObject.hasLockSound();

    const info = Lock._resolveDeviceInfo(lockObject, lock.address);
    lock.model = info.model;
    lock.firmware = info.firmware;
    lock.manufacturer = info.manufacturer;

    return lock;
  }
}

export default Lock;
