'use strict';

const fs = require('fs').promises;

class Store {
  constructor() {
    this.settingsPath = '/data';
    this.lockData = [];
    this.aliasData = {
      lock: {},
      card: {},
      finger: {}
    };
    /** @type {Object.<string, {firmwareRevision?: string, modelNum?: string, hardwareRevision?: string, factoryDate?: string}>} */
    this.deviceInfoData = {};
  }

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
    if (typeof this.aliasData.lock[address] != 'undefined') {
      return this.aliasData.lock[address];
    } else {
      return defaultValue;
    }
  }

  setCardAlias(card, alias) {
    if (typeof alias != 'undefined' && alias != '') {
      this.aliasData.card[card] = alias;
      this.saveData();
    }
  }

  getCardAlias(card) {
    if (typeof this.aliasData.card[card] != 'undefined') {
      return this.aliasData.card[card];
    } else {
      return card;
    }
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
    if (typeof this.aliasData.finger[finger] != 'undefined') {
      return this.aliasData.finger[finger];
    } else {
      return finger;
    }
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

  async saveData() {
    try {
      const tmpLock = this.settingsPath + '/lockData.json.tmp';
      await fs.writeFile(tmpLock, Buffer.from(JSON.stringify(this.lockData)));
      await fs.rename(tmpLock, this.settingsPath + '/lockData.json');
    } catch (error) {
      console.error(error);
    }
    try {
      const tmpAlias = this.settingsPath + '/aliasData.json.tmp';
      await fs.writeFile(tmpAlias, Buffer.from(JSON.stringify(this.aliasData)));
      await fs.rename(tmpAlias, this.settingsPath + '/aliasData.json');
    } catch (error) {
      console.error(error);
    }
    try {
      const tmpDeviceInfo = this.settingsPath + '/deviceInfoData.json.tmp';
      await fs.writeFile(tmpDeviceInfo, Buffer.from(JSON.stringify(this.deviceInfoData)));
      await fs.rename(tmpDeviceInfo, this.settingsPath + '/deviceInfoData.json');
    } catch (error) {
      console.error(error);
    }
  }
}

const store = new Store();

module.exports = store;
