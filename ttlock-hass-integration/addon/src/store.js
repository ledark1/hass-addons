import { promises as fs } from 'node:fs';

class Store {
  settingsPath = '/data';
  lockData = [];
  aliasData = { lock: {}, card: {}, finger: {} };
  /** @type {Object.<string, {firmwareRevision?: string, modelNum?: string, hardwareRevision?: string, factoryDate?: string}>} */
  deviceInfoData = {};

  setDataPath(path) {
    this.settingsPath = path;
  }

  getDataPath() {
    return this.settingsPath;
  }

  setLockData(newData) {
    this.lockData = Array.isArray(newData) ? newData : [];
    this.saveData();
  }

  getLockData() {
    return this.lockData;
  }

  setLockAlias(address, alias) {
    this.aliasData.lock[address] = alias;
    this.saveData();
  }

  getLockAlias(address, defaultValue = false) {
    return Object.hasOwn(this.aliasData.lock, address) ? this.aliasData.lock[address] : defaultValue;
  }

  setCardAlias(card, alias) {
    if (alias !== undefined && alias !== '') {
      this.aliasData.card[card] = alias;
      this.saveData();
    }
  }

  getCardAlias(card) {
    return Object.hasOwn(this.aliasData.card, card) ? this.aliasData.card[card] : card;
  }

  deleteCardAlias(card) {
    delete this.aliasData.card[card];
    this.saveData();
  }

  setFingerAlias(finger, alias) {
    this.aliasData.finger[finger] = alias;
    this.saveData();
  }

  getFingerAlias(finger) {
    return Object.hasOwn(this.aliasData.finger, finger) ? this.aliasData.finger[finger] : finger;
  }

  deleteFingerAlias(finger) {
    delete this.aliasData.finger[finger];
    this.saveData();
  }

  /**
   * Save the deviceInfo for a lock (persists firmware revision etc.)
   * @param {string} address Lock MAC address
   * @param {Object} deviceInfo deviceInfo object from TTLock.deviceInfo
   */
  setDeviceInfo(address, deviceInfo) {
    if (address && deviceInfo) {
      this.deviceInfoData[address] = deviceInfo;
      this.saveData();
    }
  }

  /**
   * Get the persisted deviceInfo for a lock
   * @param {string} address Lock MAC address
   * @returns {Object|undefined}
   */
  getDeviceInfo(address) {
    return this.deviceInfoData[address];
  }

  async loadData() {
    try {
      await fs.access(this.settingsPath + '/lockData.json');
      const lockDataTxt = (await fs.readFile(this.settingsPath + '/lockData.json')).toString();
      const parsed = JSON.parse(lockDataTxt);
      this.lockData = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.lockData = [];
      if (error.code !== 'ENOENT') {
        console.error(error);
      }
    }
    try {
      await fs.access(this.settingsPath + '/aliasData.json');
      const aliasDataTxt = (await fs.readFile(this.settingsPath + '/aliasData.json')).toString();
      this.aliasData = JSON.parse(aliasDataTxt);
    } catch (error) {
      this.aliasData = {
        lock: {},
        card: {},
        finger: {}
      };
      if (error.code !== 'ENOENT') {
        console.error(error);
      }
    }

    try {
      await fs.access(this.settingsPath + '/deviceInfoData.json');
      const deviceInfoDataTxt = (await fs.readFile(this.settingsPath + '/deviceInfoData.json')).toString();
      this.deviceInfoData = JSON.parse(deviceInfoDataTxt);
    } catch (error) {
      this.deviceInfoData = {};
      if (error.code !== 'ENOENT') {
        console.error(error);
      }
    }

    return this.lockData;
  }

  async fileDataRename(src, dest) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await fs.rename(src, dest);
        return;
      } catch (err) {
        if (err.code === 'EPERM' && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        } else {
          throw err;
        }
      }
    }
  }

  async saveData() {
    try {
      const tmpLock = this.settingsPath + '/lockData.json.tmp';
      await fs.writeFile(tmpLock, Buffer.from(JSON.stringify(this.lockData)));
      await this.fileDataRename(tmpLock, this.settingsPath + '/lockData.json');
    } catch (error) {
      console.error(error);
    }
    try {
      const tmpAlias = this.settingsPath + '/aliasData.json.tmp';
      await fs.writeFile(tmpAlias, Buffer.from(JSON.stringify(this.aliasData)));
      await this.fileDataRename(tmpAlias, this.settingsPath + '/aliasData.json');
    } catch (error) {
      console.error(error);
    }
    try {
      const tmpDeviceInfo = this.settingsPath + '/deviceInfoData.json.tmp';
      await fs.writeFile(tmpDeviceInfo, Buffer.from(JSON.stringify(this.deviceInfoData)));
      await this.fileDataRename(tmpDeviceInfo, this.settingsPath + '/deviceInfoData.json');
    } catch (error) {
      console.error(error);
    }
  }
}

const store = new Store();

export default store;
