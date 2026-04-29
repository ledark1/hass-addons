'use strict';

import ReconnectingWebSocket from 'reconnecting-websocket';

class Api {
  store;
  /**
   * @type {ReconnectingWebSocket}
   */
  ws;

  constructor(store, url) {
    this.store = store;
    if (url === undefined) {
      let path = globalThis.location.href.replace('http', 'ws').replace(globalThis.location.hash, '').replace('/frontend/', '/api');
      // local development (addon has to be started also)
      if (!path.endsWith('/api')) {
        path += 'api';
      }
      console.log('Discovered WS API path', path);
      this.url = path;
    } else {
      this.url = url;
    }
  }

  async connect() {
    if (this.ws === undefined) {
      this.ws = new ReconnectingWebSocket(this.url, [], {
        startClosed: true
      });

      this.ws.addEventListener('message', this._onMessage.bind(this));
    }

    this.ws.reconnect();
  }

  async scan() {
    this.ws.send(
      JSON.stringify({
        type: 'scan'
      })
    );
  }

  async lock(address) {
    this.ws.send(
      JSON.stringify({
        type: 'lock',
        data: {
          address: address
        }
      })
    );
  }

  async unlock(address) {
    this.ws.send(
      JSON.stringify({
        type: 'unlock',
        data: {
          address: address
        }
      })
    );
  }

  async pair(address) {
    this.ws.send(
      JSON.stringify({
        type: 'pair',
        data: {
          address: address
        }
      })
    );
  }

  async setAutoLock(address, time) {
    this.ws.send(
      JSON.stringify({
        type: 'settings',
        data: {
          address: address,
          settings: {
            autolock: time
          }
        }
      })
    );
  }

  async calibrateTime(address) {
    this.ws.send(
      JSON.stringify({
        type: 'settings',
        data: {
          address: address,
          settings: {
            calibrate: true
          }
        }
      })
    );
  }

  async requestCredentials(address) {
    this.ws.send(
      JSON.stringify({
        type: 'credentials',
        data: {
          address: address
        }
      })
    );
  }

  async setPasscode(address, passcode) {
    this.ws.send(
      JSON.stringify({
        type: 'passcode',
        data: {
          address: address,
          passcode: passcode
        }
      })
    );
  }

  async setCard(address, card) {
    this.ws.send(
      JSON.stringify({
        type: 'card',
        data: {
          address: address,
          card: card
        }
      })
    );
  }

  async setFinger(address, finger) {
    this.ws.send(
      JSON.stringify({
        type: 'finger',
        data: {
          address: address,
          finger: finger
        }
      })
    );
  }

  async loadConfig() {
    this.ws.send(
      JSON.stringify({
        type: 'config',
        data: {
          get: true
        }
      })
    );
  }

  async saveConfig(config) {
    this.ws.send(
      JSON.stringify({
        type: 'config',
        data: {
          set: config
        }
      })
    );
  }

  async saveSettings(address, settings) {
    this.ws.send(
      JSON.stringify({
        type: 'settings',
        data: {
          address: address,
          settings: settings
        }
      })
    );
  }

  async requestOperations(address) {
    this.ws.send(
      JSON.stringify({
        type: 'operations',
        data: {
          address: address
        }
      })
    );
  }

  async unpair(address) {
    this.ws.send(
      JSON.stringify({
        type: 'unpair',
        data: {
          address: address
        }
      })
    );
  }

  async _onMessage(messageEvent) {
    try {
      const message = JSON.parse(messageEvent.data);
      if (message.type) {
        this._handleMessage(message);
      }
    } catch (error) {
      console.error(error);
    }
  }

  _handleMessage(message) {
    switch (message.type) {
      case 'status':
        this._onStatus(message.data);
        break;
      case 'lockStatus':
        this._onLockStatus(message.data);
        break;
      case 'autolock':
        this._onAutolock();
        break;
      case 'credentials':
        this._onCredentials(message.data);
        break;
      case 'cardScan':
        this._onCardScan();
        break;
      case 'fingerScan':
        this._onFingerScan();
        break;
      case 'fingerScanProgress':
        this._onFingerScanProgress();
        break;
      case 'settings':
        this._onSettings(message.data);
        break;
      case 'error':
        this._onError(message.data);
        break;
      case 'config':
        this._onConfig(message.data);
        break;
      case 'operations':
        this._onOperations(message.data);
        break;
    }
  }

  _onStatus(data) {
    if (!data) return;
    if (data.startup !== undefined) {
      this.store.commit('setStartupStatus', data.startup);
    }
    if (data.scan !== undefined) {
      this.store.commit('setScanStatus', data.scan);
    }
    if (data.locks !== undefined) {
      this.store.commit('setLocks', data.locks);
    }
  }

  _onLockStatus(data) {
    if (data) {
      this.store.commit('setLock', data);
    }
  }

  _onAutolock() {
    this.store.commit('setWaitingAutoLock', false);
  }

  _onCredentials(data) {
    if (data?.address !== undefined) {
      this.store.commit('setCredentials', data);
    }
  }

  _onCardScan() {
    this.store.commit('setWaitingCardScan');
  }

  _onFingerScan() {
    this.store.commit('setWaitingFingerScan');
  }

  _onFingerScanProgress() {
    this.store.commit('setFingerScanProgress');
  }

  _onSettings(data) {
    this.store.commit('setWaitingSettings', false);
    if (this.store.state.waitingCalibrate) {
      this.store.commit('setCalibrateSuccess', data?.settings?.calibrate === true);
    }
    this.store.commit('setWaitingCalibrate', false);
  }

  _onError(data) {
    this.store.commit('setError', data);
  }

  _onConfig(data) {
    if (data.config === undefined) {
      this.store.commit('setWaitingConfig', false);
      if (data.set !== true) {
        this.store.commit('setError', data.set);
      }
    } else {
      this.store.commit('setConfig', data.config);
    }
  }

  _onOperations(data) {
    if (data?.address !== undefined && data?.operations !== undefined) {
      this.store.commit('setOperations', data);
    }
  }
}

export default Api;
