import mqtt from 'async-mqtt';
import manager from './manager.js';
import store from './store.js';
import { LockedStatus } from 'ttlock-sdk-js';

class HomeAssistant {
  /**
   *
   * @param {import('./manager')} manager
   * @param {Object} options
   * @param {string} options.mqttUrl
   * @param {string} options.mqttUser
   * @param {string} options.mqttPass
   * @param {string} options.discovery_prefix
   */
  constructor(options) {
    this.mqttUrl = options.mqttUrl;
    this.mqttUser = options.mqttUser;
    this.mqttPass = options.mqttPass;
    this.discovery_prefix = options.discovery_prefix || 'homeassistant';
    this.configuredLocks = new Set();

    this.connected = false;

    manager.on('lockPaired', this._onLockPaired.bind(this));
    manager.on('lockConnected', this._onLockConnected.bind(this));
    manager.on('lockUnlock', this._onLockUnlock.bind(this));
    manager.on('lockLock', this._onLockLock.bind(this));
    manager.on('lockUpdated', this._onLockBatteryUpdated.bind(this));
    manager.on('lockUnpaired', this._onLockUnpaired.bind(this));
  }

  async connect() {
    if (!this.connected) {
      try {
        this.client = await mqtt.connectAsync(this.mqttUrl, {
          username: this.mqttUser,
          password: this.mqttPass
        });
        this.client.on('message', this._onMQTTMessage.bind(this));
        this.client.on('error', (err) => {
          console.error('MQTT error:', err.message);
        });
        this.client.on('close', () => {
          if (this.connected) {
            console.log('MQTT disconnected, reconnecting in 5s...');
            this.connected = false;
            setTimeout(() => this.connect(), 5000);
          }
        });
        await this.client.subscribe('ttlock/+/set');
        this.connected = true;
        console.log('MQTT connected');
      } catch (error) {
        console.error('MQTT connection failed:', error.message);
        setTimeout(() => this.connect(), 5000);
      }
    }
  }

  /**
   * Construct a unique ID for a lock, based on the MAC address
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  getLockId(lock) {
    const address = lock.getAddress();
    return address.split(':').join('').toLowerCase();
  }

  /**
   * Configure a lock device in HA
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async configureLock(lock) {
    if (this.connected && !this.configuredLocks.has(lock.getAddress())) {
      // setup lock entity
      const id = this.getLockId(lock);
      const name = lock.getName();
      const deviceInfo = lock.deviceInfo || store.getDeviceInfo(lock.getAddress());
      const rawModel = lock.getModel();
      const rawFirmware = lock.getFirmware();
      const rawManufacturer = lock.getManufacturer();
      const device = {
        identifiers: ['ttlock_' + id],
        'name': name,
        'manufacturer': rawManufacturer && rawManufacturer !== 'unknown' ? rawManufacturer : '',
        'model': rawModel && rawModel !== 'unknown' ? rawModel : deviceInfo?.modelNum || '',
        'sw_version': rawFirmware && rawFirmware !== 'unknown' ? rawFirmware : deviceInfo?.firmwareRevision || ''
      };

      // setup lock state
      await this._publish(this.discovery_prefix + '/lock/' + id + '/lock/config', {
        unique_id: 'ttlock_' + id,
        name: name,
        device: device,
        state_topic: 'ttlock/' + id,
        command_topic: 'ttlock/' + id + '/set',
        payload_lock: 'LOCK',
        payload_unlock: 'UNLOCK',
        state_locked: 'LOCK',
        state_unlocked: 'UNLOCK',
        value_template: '{{ value_json.state }}',
        optimistic: false,
        retain: false
      });

      // setup battery sensor
      await this._publish(this.discovery_prefix + '/sensor/' + id + '/battery/config', {
        unique_id: 'ttlock_' + id + '_battery',
        name: name + ' Battery',
        device: device,
        device_class: 'battery',
        unit_of_measurement: '%',
        state_topic: 'ttlock/' + id,
        value_template: '{{ value_json.battery }}'
      });

      // setup rssi sensor
      await this._publish(this.discovery_prefix + '/sensor/' + id + '/rssi/config', {
        unique_id: 'ttlock_' + id + '_rssi',
        name: name + ' RSSI',
        device: device,
        unit_of_measurement: 'dB',
        icon: 'mdi:signal',
        state_topic: 'ttlock/' + id,
        value_template: '{{ value_json.rssi }}'
      });

      this.configuredLocks.add(lock.getAddress());
    }
  }

  async _publish(topic, payload) {
    if (process.env.MQTT_DEBUG == '1') {
      console.log('MQTT Publish', topic, JSON.stringify(payload));
    }
    await this.client.publish(topic, JSON.stringify(payload), { retain: true });
  }

  /**
   * Update the readings of a lock in HA
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async updateLockState(lock) {
    if (this.connected) {
      try {
        const id = this.getLockId(lock);
        const stateTopic = 'ttlock/' + id;
        const lockedStatus = await lock.getLockStatus();
        let statePayload = {
          battery: lock.getBattery(),
          rssi: lock.getRssi()
        };
        if (lockedStatus != LockedStatus.UNKNOWN) {
          statePayload.state = lockedStatus == LockedStatus.LOCKED ? 'LOCK' : 'UNLOCK';
        }

        if (process.env.MQTT_DEBUG == '1') {
          console.log('MQTT Publish', stateTopic, JSON.stringify(statePayload));
        }
        await this.client.publish(stateTopic, JSON.stringify(statePayload), { retain: true });
      } catch (error) {
        console.error('MQTT updateLockState error:', error.message);
      }
    }
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockPaired(lock) {
    await this.configureLock(lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockConnected(lock) {
    await this.configureLock(lock);
    await this.updateLockState(lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockUnlock(lock) {
    await this.updateLockState(lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockLock(lock) {
    await this.updateLockState(lock);
  }

  /**
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockBatteryUpdated(lock) {
    await this.updateLockState(lock);
  }

  /**
   * Remove a lock's MQTT discovery entries when it is unpaired
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockUnpaired(lock) {
    if (!this.connected) return;
    const id = this.getLockId(lock);
    const topics = [this.discovery_prefix + '/lock/' + id + '/lock/config', this.discovery_prefix + '/sensor/' + id + '/battery/config', this.discovery_prefix + '/sensor/' + id + '/rssi/config'];
    for (const topic of topics) {
      if (process.env.MQTT_DEBUG == '1') {
        console.log('MQTT Remove discovery', topic);
      }
      await this.client.publish(topic, '', { retain: true });
    }
    this.configuredLocks.delete(lock.getAddress());
  }

  /**
   *
   * @param {string} topic
   * @param {Buffer} message
   */
  _onMQTTMessage(topic, message) {
    /**
     * Topic: ttlock/e1581b3a605e/set
       Message: UNLOCK
     */
    let topicArr = topic.split('/');
    if (topicArr.length == 3 && topicArr[0] == 'ttlock' && topicArr[2] == 'set' && topicArr[1].length == 12) {
      let address = '';
      for (let i = 0; i < topicArr[1].length; i++) {
        address += topicArr[1][i];
        if (i < topicArr[1].length - 1 && i % 2 == 1) {
          address += ':';
        }
      }
      address = address.toUpperCase();
      const command = message.toString('utf8');
      if (process.env.MQTT_DEBUG == '1') {
        console.log('MQTT command:', address, command);
      }
      switch (command) {
        case 'LOCK':
          manager.lockLock(address);
          break;
        case 'UNLOCK':
          manager.unlockLock(address);
          break;
      }
    } else if (process.env.MQTT_DEBUG == '1') {
      console.log('Topic:', topic);
      console.log('Message:', message.toString('utf8'));
    }
  }
}

export default HomeAssistant;
