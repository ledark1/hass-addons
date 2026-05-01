import { sleep } from '@domodom30/ttlock-sdk-js';
import WebSocket from 'ws';
import manager from '../src/manager.js';
import store from '../src/store.js';
import Message from './Message.js';
import WsApi from './WsApi.js';

// ── case handlers ────────────────────────────────────────────────────────────

async function handlePair(wss, msg) {
  if (!msg.data?.address) return;
  const paired = await manager.initLock(msg.data.address);
  if (paired) return;
  const lock = manager.getNewVisible().get(msg.data.address);
  if (lock) WsApi.sendLockStatus(wss, lock);
}

async function handleLockOrUnlock(wss, msg, op) {
  if (!msg.data?.address) return;
  const result = await op(msg.data.address);
  if (result) return;
  const lock = manager.getPairedVisible().get(msg.data.address);
  if (lock) WsApi.sendLockStatus(wss, lock);
}

async function handleCredentials(api, ws, msg) {
  if (!msg.data?.address) return;
  if (process.env.DEV_MODE) {
    WsApi._devSendCredentials(ws);
    return;
  }
  const credentials = await manager.getCredentials(msg.data.address);
  if (!credentials) {
    api.sendError('Failed fetching credentials', msg);
    return;
  }
  api.sendCredentials(msg.data.address, credentials);
}

async function handlePasscode(api, ws, msg) {
  if (!msg.data?.address || !msg.data?.passcode) return;
  if (process.env.DEV_MODE) {
    WsApi._devSendCredentials(ws);
    return;
  }

  const passcode = msg.data.passcode;
  console.log('passcode operation received:', JSON.stringify(passcode));
  const address = msg.data.address;

  const passCodeIsNew = passcode.passCode == null || passcode.passCode === '' || passcode.passCode == -1;
  const passCodeIsDelete = passcode.newPassCode == null || passcode.newPassCode === '' || passcode.newPassCode == -1;

  // Each manager method now returns the updated passcodes array on success, or false on failure.
  let passcodes = false;
  if (passCodeIsNew) {
    if (!passcode.newPassCode || !passcode.startDate || !passcode.endDate) {
      api.sendError('Invalid passcode data: missing required fields', msg);
      return;
    }
    passcodes = await manager.addPasscode(address, passcode.type, passcode.newPassCode, passcode.startDate, passcode.endDate);
  } else if (passCodeIsDelete) {
    const codeToDelete = passcode.passCode || passcode.newPassCode;
    if (!codeToDelete) {
      api.sendError('Invalid passcode data: cannot determine code to delete', msg);
      return;
    }
    passcodes = await manager.deletePasscode(address, passcode.type, codeToDelete);
  } else {
    if (!passcode.passCode || !passcode.newPassCode) {
      api.sendError('Invalid passcode data: missing passCode or newPassCode for update', msg);
      return;
    }
    const startDate = passcode.startDate || '200001010000';
    const endDate = passcode.endDate || '209912012359';
    passcodes = await manager.updatePasscode(address, passcode.type, passcode.passCode, passcode.newPassCode, startDate, endDate);
  }

  if (!passcodes) {
    api.sendError('PIN operation failed', msg);
    return;
  }
  api.sendPasscodes(address, passcodes);
}

async function handleCard(api, ws, msg) {
  if (!msg.data?.address || !msg.data?.card) return;
  if (process.env.DEV_MODE) {
    WsApi._devSendCredentials(ws);
    return;
  }

  const card = msg.data.card;
  const address = msg.data.address;
  // Each manager method now returns the updated cards array on success, or false on failure.
  let cards = false;

  if (card.cardNumber == -1) {
    cards = await manager.addCard(address, card.startDate, card.endDate, card.alias);
  } else if (card.startDate == -1) {
    cards = await manager.deleteCard(address, card.cardNumber);
  } else {
    cards = await manager.updateCard(address, card.cardNumber, card.startDate, card.endDate, card.alias);
  }

  if (!cards) {
    api.sendError('Card operation failed', msg);
    return;
  }
  api.sendCards(address, cards);
}

async function handleFinger(api, ws, msg) {
  if (!msg.data?.address || !msg.data?.finger) return;
  if (process.env.DEV_MODE) {
    WsApi._devSendCredentials(ws);
    return;
  }

  const finger = msg.data.finger;
  const address = msg.data.address;
  // Each manager method now returns the updated fingers array on success, or false on failure.
  let fingers = false;

  if (finger.fpNumber == -1) {
    fingers = await manager.addFinger(address, finger.startDate, finger.endDate, finger.alias);
  } else if (finger.startDate == -1) {
    fingers = await manager.deleteFinger(address, finger.fpNumber);
  } else {
    fingers = await manager.updateFinger(address, finger.fpNumber, finger.startDate, finger.endDate, finger.alias);
  }

  if (!fingers) {
    api.sendError('Fingerprint operation failed', msg);
    return;
  }
  api.sendFingers(address, fingers);
}

async function handleSettings(api, msg) {
  if (!msg.data?.address || !msg.data.settings) return;
  const { address, settings } = msg.data;
  const confirmed = {};

  if (settings.autolock !== undefined) {
    confirmed.autolock = await manager.setAutoLock(address, Number.parseInt(settings.autolock));
    if (confirmed.autolock !== true) api.sendError('Unable to set auto-lock time', msg);
  }

  if (settings.audio !== undefined) {
    confirmed.audio = await manager.setAudio(address, settings.audio);
    if (confirmed.audio !== true) api.sendError('Failed to set audio mode', msg);
  }

  if (settings.calibrate) {
    confirmed.calibrate = await manager.calibrateTime(address);
    if (confirmed.calibrate !== true) api.sendError('Failed to calibrate lock clock', msg);
  }

  if (confirmed.autolock || confirmed.audio || confirmed.calibrate) {
    await sleep(10);
  }
  api.sendSettingsConfirmation(address, confirmed);
}

async function handleConfig(api, msg) {
  if (!msg.data) return;
  if (msg.data.get) {
    api.sendConfig();
    return;
  }
  if (!msg.data.set) return;
  try {
    const lockData = JSON.parse(msg.data.set);
    store.setLockData(lockData);
    manager.updateClientLockDataFromStore();
    manager.startScan();
    api.sendConfigConfirm();
  } catch (error) {
    console.error('Failed to set config:', error);
    api.sendConfigConfirm('Failed to set config');
  }
}

async function handleOperations(api, msg) {
  if (!msg.data?.address) return;
  const operations = await manager.getOperationLog(msg.data.address, true);
  if (!operations) {
    api.sendError('Failed getting operation log', msg);
    return;
  }
  api.sendOperationLog(msg.data.address, operations);
}

async function handleUnpair(api, msg) {
  if (!msg.data?.address) return;
  const res = await manager.resetLock(msg.data.address);
  if (!res) api.sendError('Failed to unpair lock', msg);
}

// ── main message dispatcher ──────────────────────────────────────────────────

async function onMessage(wss, api, ws, message) {
  const msg = new Message(message);
  if (!msg.isValid()) return;

  switch (msg.type) {
    case 'status':
      WsApi.sendStatus(wss);
      break;
    case 'scan':
      manager.startScan();
      break;
    case 'pair':
      await handlePair(wss, msg);
      break;
    case 'lock':
      await handleLockOrUnlock(wss, msg, (addr) => manager.lockLock(addr));
      break;
    case 'unlock':
      await handleLockOrUnlock(wss, msg, (addr) => manager.unlockLock(addr));
      break;
    case 'credentials':
      await handleCredentials(api, ws, msg);
      break;
    case 'passcode':
      await handlePasscode(api, ws, msg);
      break;
    case 'card':
      await handleCard(api, ws, msg);
      break;
    case 'finger':
      await handleFinger(api, ws, msg);
      break;
    case 'settings':
      await handleSettings(api, msg);
      break;
    case 'config':
      await handleConfig(api, msg);
      break;
    case 'operations':
      await handleOperations(api, msg);
      break;
    case 'unpair':
      await handleUnpair(api, msg);
      break;
  }
}

// ── export ───────────────────────────────────────────────────────────────────

export default async function initApi(server) {
  const wss = new WebSocket.Server({ server, path: '/api' });

  async function sendStatusUpdate() {
    WsApi.sendStatus(wss);
  }
  async function sendLockStatusUpdate(lock) {
    WsApi.sendLockStatus(wss, lock);
  }

  manager.on('lockListChanged', sendStatusUpdate);
  manager.on('lockPaired', sendStatusUpdate);
  manager.on('lockConnected', sendLockStatusUpdate);
  manager.on('lockLock', sendLockStatusUpdate);
  manager.on('lockUnlock', sendLockStatusUpdate);
  manager.on('lockUpdated', sendLockStatusUpdate);
  manager.on('scanStart', sendStatusUpdate);
  manager.on('scanStop', sendStatusUpdate);
  manager.on('adapterReady', sendStatusUpdate);

  wss.on('connection', (ws) => {
    const api = new WsApi(ws);

    ws.on('message', async (message) => onMessage(wss, api, ws, message));

    async function sendLockCardScan(lock) {
      api.sendCardScan(lock.getAddress());
    }
    async function sendLockFingerScan(lock) {
      api.sendFingerScan(lock.getAddress());
    }
    async function sendLockFingerScanProgress(lock) {
      api.sendFingerScanProgress(lock.getAddress());
    }

    manager.on('lockCardScan', sendLockCardScan);
    manager.on('lockFingerScan', sendLockFingerScan);
    manager.on('lockFingerScanProgress', sendLockFingerScanProgress);

    ws.on('close', async () => {
      manager.off('lockCardScan', sendLockCardScan);
      manager.off('lockFingerScan', sendLockFingerScan);
      manager.off('lockFingerScanProgress', sendLockFingerScanProgress);
    });

    WsApi.sendStatus(wss);
  });
}
