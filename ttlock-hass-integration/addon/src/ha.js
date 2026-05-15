import mqtt from 'async-mqtt';
import manager from './manager.js';
import store from './store.js';
import { LockedStatus } from '@domodom30/ttlock-sdk-js';
import {
  BRIDGE_AVAILABILITY_TOPIC,
  PAYLOAD_ONLINE,
  PAYLOAD_OFFLINE,
  lockIdFromAddress,
  stateTopic,
  commandTopic,
  commandSubscription,
  lockAvailabilityTopic,
  lastOperationTopic,
  discoveryConfigTopic,
  parseCommandTopic,
  latestOperation,
  buildLastOperationPayload
} from './mqttTopics.js';

class HomeAssistant {
  /**
   *
   * @param {import('./manager')} manager
   * @param {Object} options
   * @param {string} options.mqttUrl
   * @param {string} [options.mqttUser] optional — anonymous broker supported
   * @param {string} [options.mqttPass] optional — anonymous broker supported
   * @param {string} [options.discovery_prefix]
   */
  constructor(options) {
    this.mqttUrl = options.mqttUrl;
    this.mqttUser = options.mqttUser;
    this.mqttPass = options.mqttPass;
    this.discovery_prefix = options.discovery_prefix || 'homeassistant';
    this.configuredLocks = new Set();

    this.connected = false;
    this._connecting = false;
    this._reconnectTimer = null;

    manager.on('lockPaired', this._onLockPaired.bind(this));
    manager.on('lockConnected', this._onLockConnected.bind(this));
    manager.on('lockUnlock', this._onLockUnlock.bind(this));
    manager.on('lockLock', this._onLockLock.bind(this));
    manager.on('lockUpdated', this._onLockBatteryUpdated.bind(this));
    manager.on('lockUnpaired', this._onLockUnpaired.bind(this));
  }

  /** Schedule a single reconnection attempt (guarded against duplicates). */
  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  async connect() {
    if (this._connecting) return;
    this._connecting = true;
    try {
      // Tear down any previous client first — the old 'close' handler must not
      // survive, otherwise listeners accumulate and several clients reconnect
      // in parallel.
      if (this.client) {
        this.client.removeAllListeners();
        await this.client.end(true).catch(() => {});
        this.client = null;
      }

      this.client = await mqtt.connectAsync(this.mqttUrl, {
        username: this.mqttUser || undefined,
        password: this.mqttPass || undefined,
        // Disable mqtt.js' built-in auto-reconnect — we drive a single
        // reconnection loop ourselves via the 'close' handler.
        reconnectPeriod: 0,
        will: {
          topic: BRIDGE_AVAILABILITY_TOPIC,
          payload: PAYLOAD_OFFLINE,
          qos: 1,
          retain: true
        }
      });

      this.client.on('message', this._onMQTTMessage.bind(this));
      this.client.on('error', (err) => {
        console.error('MQTT error:', err.message);
      });
      this.client.on('close', () => {
        if (this.connected) {
          console.log('MQTT disconnected, reconnecting in 5s...');
          this.connected = false;
          this._scheduleReconnect();
        }
      });

      await this.client.subscribe(commandSubscription(), { qos: 1 });
      this.connected = true;
      console.log('MQTT connected');
      // Publishes bridge availability 'online' then republishes every known
      // lock — required because the broker may have restarted.
      await this._republishAll();
    } catch (error) {
      console.error('MQTT connection failed:', error.message);
      this._scheduleReconnect();
    } finally {
      this._connecting = false;
    }
  }

  /**
   * Construct a unique ID for a lock, based on the MAC address
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  getLockId(lock) {
    return lockIdFromAddress(lock.getAddress());
  }

  /**
   * Build the Home Assistant device block shared by every entity of a lock.
   * @param {import('ttlock-sdk-js').TTLock} lock
   * @param {string} id
   */
  _buildDevice(lock, id) {
    const deviceInfo = lock.deviceInfo || store.getDeviceInfo(lock.getAddress());
    const rawModel = lock.getModel();
    const rawFirmware = lock.getFirmware();
    const rawManufacturer = lock.getManufacturer();
    return {
      identifiers: ['ttlock_' + id],
      name: lock.getName(),
      manufacturer: rawManufacturer && rawManufacturer !== 'unknown' ? rawManufacturer : '',
      model: rawModel && rawModel !== 'unknown' ? rawModel : deviceInfo?.modelNum || '',
      sw_version: rawFirmware && rawFirmware !== 'unknown' ? rawFirmware : deviceInfo?.firmwareRevision || ''
    };
  }

  /**
   * Hybrid availability: an entity is available only when BOTH the bridge and
   * the lock report 'online' (availability_mode: all).
   * @param {string} id
   */
  _hybridAvailability(id) {
    return {
      availability: [
        { topic: BRIDGE_AVAILABILITY_TOPIC, payload_available: PAYLOAD_ONLINE, payload_not_available: PAYLOAD_OFFLINE },
        { topic: lockAvailabilityTopic(id), payload_available: PAYLOAD_ONLINE, payload_not_available: PAYLOAD_OFFLINE }
      ],
      availability_mode: 'all'
    };
  }

  /**
   * Configure a lock device in HA
   * @param {import('ttlock-sdk-js').TTLock} lock
   * @param {boolean} [force] republish discovery even if already configured
   */
  async configureLock(lock, force = false) {
    if (!this.connected) return;
    if (!force && this.configuredLocks.has(lock.getAddress())) return;

    const id = lockIdFromAddress(lock.getAddress());
    const name = lock.getName();
    const device = this._buildDevice(lock, id);
    const avail = this._hybridAvailability(id);

    const entities = [
      {
        component: 'lock',
        objectId: 'lock',
        payload: {
          unique_id: 'ttlock_' + id,
          name: name,
          device: device,
          state_topic: stateTopic(id),
          command_topic: commandTopic(id),
          payload_lock: 'LOCK',
          payload_unlock: 'UNLOCK',
          state_locked: 'LOCK',
          state_unlocked: 'UNLOCK',
          value_template: '{{ value_json.state }}',
          optimistic: false,
          retain: false,
          qos: 1,
          ...avail
        }
      },
      {
        component: 'sensor',
        objectId: 'battery',
        payload: {
          unique_id: 'ttlock_' + id + '_battery',
          name: name + ' Battery',
          device: device,
          device_class: 'battery',
          unit_of_measurement: '%',
          state_topic: stateTopic(id),
          value_template: '{{ value_json.battery }}',
          ...avail
        }
      },
      {
        component: 'sensor',
        objectId: 'rssi',
        payload: {
          unique_id: 'ttlock_' + id + '_rssi',
          name: name + ' RSSI',
          device: device,
          unit_of_measurement: 'dB',
          icon: 'mdi:signal',
          state_topic: stateTopic(id),
          value_template: '{{ value_json.rssi }}',
          ...avail
        }
      },
      {
        component: 'sensor',
        objectId: 'last_operation',
        payload: {
          unique_id: 'ttlock_' + id + '_last_operation',
          name: name + ' Last operation',
          device: device,
          icon: 'mdi:history',
          state_topic: lastOperationTopic(id),
          value_template: '{{ value_json.event }}',
          json_attributes_topic: lastOperationTopic(id),
          ...avail
        }
      },
      {
        component: 'binary_sensor',
        objectId: 'connectivity',
        payload: {
          unique_id: 'ttlock_' + id + '_connectivity',
          name: name + ' Connectivity',
          device: device,
          device_class: 'connectivity',
          state_topic: lockAvailabilityTopic(id),
          payload_on: PAYLOAD_ONLINE,
          payload_off: PAYLOAD_OFFLINE,
          // Depends on the bridge only so it stays visible/historised even
          // when the lock itself is offline.
          availability: [
            { topic: BRIDGE_AVAILABILITY_TOPIC, payload_available: PAYLOAD_ONLINE, payload_not_available: PAYLOAD_OFFLINE }
          ]
        }
      }
    ];

    for (const entity of entities) {
      await this._publish(
        discoveryConfigTopic(this.discovery_prefix, entity.component, id, entity.objectId),
        entity.payload,
        { retain: true, qos: 1 }
      );
    }

    this.configuredLocks.add(lock.getAddress());
  }

  /**
   * Publish a payload. Objects are JSON-encoded; strings are sent as-is
   * (availability / retained-message purges).
   * @param {string} topic
   * @param {object|string} payload
   * @param {{retain?: boolean, qos?: number}} [options]
   */
  async _publish(topic, payload, { retain = true, qos = 0 } = {}) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (process.env.MQTT_DEBUG == '1') {
      console.log('MQTT Publish', topic, data);
    }
    await this.client.publish(topic, data, { retain, qos });
  }

  /**
   * Update the readings of a lock in HA
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async updateLockState(lock) {
    if (!this.connected) return;
    try {
      const id = lockIdFromAddress(lock.getAddress());
      const lockedStatus = await lock.getLockStatus();
      const statePayload = {
        battery: lock.getBattery(),
        rssi: lock.getRssi()
      };
      if (lockedStatus != LockedStatus.UNKNOWN) {
        statePayload.state = lockedStatus == LockedStatus.LOCKED ? 'LOCK' : 'UNLOCK';
      }
      await this._publish(stateTopic(id), statePayload, { retain: true, qos: 1 });
    } catch (error) {
      console.error('MQTT updateLockState error:', error.message);
    }
  }

  /**
   * Publish per-lock availability ('online' / 'offline').
   * @param {import('ttlock-sdk-js').TTLock} lock
   * @param {boolean} online
   */
  async publishLockAvailability(lock, online) {
    if (!this.connected) return;
    const id = lockIdFromAddress(lock.getAddress());
    await this._publish(lockAvailabilityTopic(id), online ? PAYLOAD_ONLINE : PAYLOAD_OFFLINE, {
      retain: true,
      qos: 1
    });
  }

  /**
   * Publish the most recent operation-log entry (who locked/unlocked, when).
   * Reads the persisted log only — no BLE.
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async publishLastOperation(lock) {
    if (!this.connected) return;
    try {
      const ops = manager.getPersistedOperationLog(lock.getAddress());
      const last = latestOperation(ops);
      if (!last) return;
      const id = lockIdFromAddress(lock.getAddress());
      await this._publish(lastOperationTopic(id), buildLastOperationPayload(last), {
        retain: true,
        qos: 1
      });
    } catch (error) {
      console.error('MQTT publishLastOperation error:', error.message);
    }
  }

  /**
   * Re-publish bridge availability and every known lock's discovery + state
   * after a (re)connection — retained messages alone are not enough if the
   * broker restarted.
   */
  async _republishAll() {
    await this._publish(BRIDGE_AVAILABILITY_TOPIC, PAYLOAD_ONLINE, { retain: true, qos: 1 });
    for (const address of this.configuredLocks) {
      const lock = manager.pairedLocks?.get?.(address);
      if (!lock) continue;
      try {
        await this.configureLock(lock, true);
        await this.publishLockAvailability(lock, true);
        await this.updateLockState(lock);
        await this.publishLastOperation(lock);
      } catch (error) {
        console.error('MQTT republish error:', error.message);
      }
    }
  }

  /**
   * Publish availability + state + last operation for a lock.
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _refreshLock(lock) {
    await this.publishLockAvailability(lock, true);
    await this.updateLockState(lock);
    await this.publishLastOperation(lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockPaired(lock) {
    await this.configureLock(lock);
    await this._refreshLock(lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockConnected(lock) {
    await this.configureLock(lock);
    await this._refreshLock(lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockUnlock(lock) {
    await this._refreshLock(lock);
  }

  /**
   *
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockLock(lock) {
    await this._refreshLock(lock);
  }

  /**
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockBatteryUpdated(lock) {
    await this._refreshLock(lock);
  }

  /**
   * Remove a lock's MQTT discovery entries when it is unpaired
   * @param {import('ttlock-sdk-js').TTLock} lock
   */
  async _onLockUnpaired(lock) {
    if (!this.connected) return;
    const id = lockIdFromAddress(lock.getAddress());
    const discoveryTopics = [
      discoveryConfigTopic(this.discovery_prefix, 'lock', id, 'lock'),
      discoveryConfigTopic(this.discovery_prefix, 'sensor', id, 'battery'),
      discoveryConfigTopic(this.discovery_prefix, 'sensor', id, 'rssi'),
      discoveryConfigTopic(this.discovery_prefix, 'sensor', id, 'last_operation'),
      discoveryConfigTopic(this.discovery_prefix, 'binary_sensor', id, 'connectivity')
    ];
    for (const topic of discoveryTopics) {
      if (process.env.MQTT_DEBUG == '1') {
        console.log('MQTT Remove discovery', topic);
      }
      await this._publish(topic, '', { retain: true });
    }
    // Purge retained data topics so a re-pair starts clean.
    for (const topic of [stateTopic(id), lockAvailabilityTopic(id), lastOperationTopic(id)]) {
      await this._publish(topic, '', { retain: true });
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
    const parsed = parseCommandTopic(topic);
    if (parsed) {
      const command = message.toString('utf8');
      if (process.env.MQTT_DEBUG == '1') {
        console.log('MQTT command:', parsed.address, command);
      }
      switch (command) {
        case 'LOCK':
          manager.lockLock(parsed.address);
          break;
        case 'UNLOCK':
          manager.unlockLock(parsed.address);
          break;
      }
    } else if (process.env.MQTT_DEBUG == '1') {
      console.log('Topic:', topic);
      console.log('Message:', message.toString('utf8'));
    }
  }
}

export default HomeAssistant;
