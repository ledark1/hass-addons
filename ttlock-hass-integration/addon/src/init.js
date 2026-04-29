import HomeAssistant from './ha.js';
import store from './store.js';
import manager from './manager.js';
import express from 'express';
import api from '../api/index.js';

/**
 * Handle the initialisation process
 * - load saved data
 * - create manager
 * - create express app
 * @param {Object} options
 * @param {string} options.settingsPath Path to the file in which lock data settings are saved
 * @param {string} options.mqttHost MQTT host
 * @param {string} options.mqttPort MQTT port
 * @param {string} options.mqttSSL MQTT ssl
 * @param {string} options.mqttUser MQTT username
 * @param {string} options.mqttPass MQTT password
 * @param {'none'|'noble'} options.gateway External BLE gateway type
 * @param {string} options.gateway_host Gateway hostname or IP
 * @param {number} options.gateway_port Gateway port
 * @param {string} options.gateway_key Gateway AES key
 * @param {string} options.gateway_user Gateway username
 * @param {string} options.gateway_pass  Gateway password
 */
export default async function init(options = {}) {
  // load saved data
  if (options.settingsPath) {
    store.setDataPath(options.settingsPath);
  }
  await store.loadData();

  // initialize manager
  if (options.gateway === 'noble') {
    manager.setNobleGateway(options.gateway_host, options.gateway_port, options.gateway_key, options.gateway_user, options.gateway_pass);
  }
  if (options.mqttHost && options.mqttUser && options.mqttPass) {
    const haOptions = {
      mqttUrl: (options.mqttSSL === 'true' ? 'mqtts://' : 'mqtt://') + options.mqttHost + ':' + options.mqttPort,
      mqttUser: options.mqttUser,
      mqttPass: options.mqttPass
    };
    const ha = new HomeAssistant(haOptions);
    await ha.connect();
  }

  await manager.init();

  // create express app
  const app = express();
  const port = options.port ?? 55099;

  // Because we use host networking we need to filter out
  // all requests except those coming from the HA proxy
  const localIP = options.localIP ?? ['172.30.32.2', '::ffff:172.30.32.2', '::1', '::ffff:127.0.0.1'];
  app.use((req, res, next) => {
    if (localIP.includes(req.ip)) {
      next();
    } else {
      res.status(403).send('Denied');
    }
  });

  app.use('/frontend', express.static('frontend'));

  const server = app.listen(port, () => {
    console.log('Server started');
  });

  api(server);
}
