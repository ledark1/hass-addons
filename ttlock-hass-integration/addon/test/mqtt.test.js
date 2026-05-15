import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_PREFIX,
  BRIDGE_AVAILABILITY_TOPIC,
  PAYLOAD_ONLINE,
  PAYLOAD_OFFLINE,
  lockIdFromAddress,
  addressFromLockId,
  stateTopic,
  commandTopic,
  commandSubscription,
  lockAvailabilityTopic,
  lastOperationTopic,
  discoveryConfigTopic,
  parseCommandTopic,
  latestOperation,
  buildLastOperationPayload
} from '../src/mqttTopics.js';

test('constants', () => {
  assert.equal(DATA_PREFIX, 'ttlock');
  assert.equal(BRIDGE_AVAILABILITY_TOPIC, 'ttlock/bridge/availability');
  assert.equal(PAYLOAD_ONLINE, 'online');
  assert.equal(PAYLOAD_OFFLINE, 'offline');
});

test('lockIdFromAddress', () => {
  assert.equal(lockIdFromAddress('E1:58:1B:3A:60:5E'), 'e1581b3a605e');
  assert.equal(lockIdFromAddress('e1:58:1b:3a:60:5e'), 'e1581b3a605e');
});

test('addressFromLockId valid / round-trip', () => {
  assert.equal(addressFromLockId('e1581b3a605e'), 'E1:58:1B:3A:60:5E');
  const addr = 'AB:CD:EF:01:23:45';
  assert.equal(addressFromLockId(lockIdFromAddress(addr)), addr);
});

test('addressFromLockId rejects bad input', () => {
  assert.equal(addressFromLockId(''), null);
  assert.equal(addressFromLockId('e1581b3a605'), null); // 11 chars
  assert.equal(addressFromLockId('e1581b3a605e0'), null); // 13 chars
  assert.equal(addressFromLockId('e1581b3a605z'), null); // non-hex
  assert.equal(addressFromLockId(null), null);
  assert.equal(addressFromLockId(123456789012), null);
});

test('topic helpers', () => {
  assert.equal(stateTopic('e1581b3a605e'), 'ttlock/e1581b3a605e');
  assert.equal(commandTopic('e1581b3a605e'), 'ttlock/e1581b3a605e/set');
  assert.equal(commandSubscription(), 'ttlock/+/set');
  assert.equal(lockAvailabilityTopic('e1581b3a605e'), 'ttlock/e1581b3a605e/availability');
  assert.equal(lastOperationTopic('e1581b3a605e'), 'ttlock/e1581b3a605e/last_operation');
  assert.equal(
    discoveryConfigTopic('homeassistant', 'sensor', 'e1581b3a605e', 'battery'),
    'homeassistant/sensor/e1581b3a605e/battery/config'
  );
  assert.equal(
    discoveryConfigTopic('ha', 'binary_sensor', 'e1581b3a605e', 'connectivity'),
    'ha/binary_sensor/e1581b3a605e/connectivity/config'
  );
});

test('parseCommandTopic valid', () => {
  assert.deepEqual(parseCommandTopic('ttlock/e1581b3a605e/set'), {
    address: 'E1:58:1B:3A:60:5E'
  });
});

test('parseCommandTopic rejects', () => {
  assert.equal(parseCommandTopic('ttlock/e1581b3a605e'), null); // 2 segments
  assert.equal(parseCommandTopic('ttlock/e1581b3a605e/set/x'), null); // 4 segments
  assert.equal(parseCommandTopic('other/e1581b3a605e/set'), null); // wrong prefix
  assert.equal(parseCommandTopic('ttlock/e1581b3a605e/get'), null); // wrong action
  assert.equal(parseCommandTopic('ttlock/e1581b3a60/set'), null); // id not 12
  assert.equal(parseCommandTopic('ttlock/e1581b3a605z/set'), null); // id not hex
  assert.equal(parseCommandTopic('homeassistant/lock/e1581b3a605e/lock/config'), null);
  assert.equal(parseCommandTopic(null), null);
});

test('latestOperation picks newest (operateDate then recordNumber)', () => {
  assert.equal(latestOperation([]), null);
  assert.equal(latestOperation(null), null);
  const ops = [
    { operateDate: '2026-05-10 10:00:00', recordNumber: 1 },
    { operateDate: '2026-05-12 08:00:00', recordNumber: 5 },
    { operateDate: '2026-05-12 08:00:00', recordNumber: 6 }, // tie -> highest recordNumber
    { operateDate: '2026-05-11 23:00:00', recordNumber: 4 }
  ];
  assert.equal(latestOperation(ops).recordNumber, 6);
});

test('buildLastOperationPayload', () => {
  const op = {
    recordType: 4,
    recordTypeName: 'Unlock by IC card',
    recordTypeCategory: 'UNLOCK',
    password: '1234567',
    passwordName: 'Carte Alice',
    recordNumber: 42,
    operateDate: '2026-05-15 09:30:00',
    electricQuantity: 0
  };
  assert.deepEqual(buildLastOperationPayload(op), {
    event: 'Unlock by IC card',
    category: 'UNLOCK',
    by: 'Carte Alice',
    record_type: 4,
    record_number: 42,
    timestamp: '2026-05-15 09:30:00',
    battery: 0 // numeric 0 kept, not coerced to null
  });
});

test('buildLastOperationPayload falls back to password then null', () => {
  const noName = buildLastOperationPayload({ password: '999', recordType: 1 });
  assert.equal(noName.by, '999');
  const nothing = buildLastOperationPayload({ recordType: 1 });
  assert.equal(nothing.by, null);
  assert.equal(nothing.event, null);
});
