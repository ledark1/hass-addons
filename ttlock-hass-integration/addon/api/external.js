import express from 'express';
import manager from '../src/manager.js';

/** TTLock date strings are exactly 12 digits: YYYYMMDDHHmm */
function isTTLockDate(d) {
  return typeof d === 'string' && /^\d{12}$/.test(d);
}

/** Passcode must be digits only (4–9 per TTLock firmware). */
function isDigits(v) {
  return typeof v === 'string' && /^\d{4,9}$/.test(v);
}

/**
 * External machine-to-machine REST API (`/api/ext/*`), called by the yk-immo
 * platform over the WireGuard tunnel. Auth = a static bearer key
 * (`X-API-Key` header or `Authorization: Bearer <key>`).
 *
 * This router is mounted BEFORE the HA-ingress IP filter in init.js, so it is
 * reachable from outside the HA proxy — but ONLY with the configured key. When
 * no key is configured the whole surface returns 503 (disabled).
 *
 * Passcode `type`: 1 = permanent (only type enabled in the addon UI, the most
 * reliable), 3 = timed/period. Default 1 — the platform enforces validity by
 * deleting the code at check-out rather than relying on the lock's clock.
 *
 * @param {string} apiKey
 * @returns {import('express').Router}
 */
export default function externalApi(apiKey) {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  // Auth gate — constant work regardless of outcome, no early hints.
  router.use((req, res, next) => {
    if (!apiKey) return res.status(503).json({ error: 'External API disabled (no key configured)' });
    const provided = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (provided !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });

  // List paired locks (address + name).
  router.get('/locks', (req, res) => {
    const locks = [...manager.getPairedVisible().values()].map((l) => ({
      address: l.getAddress(),
      name: l.name ?? null,
    }));
    res.json({ locks });
  });

  // List passcodes for a lock (BLE read — may take several seconds).
  router.get('/locks/:address/passcodes', async (req, res) => {
    const creds = await manager.getCredentials(req.params.address);
    if (!creds || creds.passcodes === false) {
      return res.status(502).json({ error: 'Failed fetching passcodes' });
    }
    res.json({ passcodes: creds.passcodes });
  });

  // Operation / activity log for a lock — record number, date, type, code used.
  //
  // Default: persisted log from lockData.json (instant, NO BLE). This already
  // holds the full history the addon has ever pulled, so it survives the lock
  // being out of range / the gateway being down.
  //
  // `?reload=1` forces a fresh BLE fetch first (slow, several seconds, requires
  // the lock in range) to pull entries newer than the last sync, then returns
  // the merged persisted log.
  //
  // Each entry: { recordNumber, operateDate ("YYYYMMDDHHmmss", lock-local),
  // recordType, recordTypeName, recordTypeCategory (LOCK|UNLOCK|FAILED|ALARM|
  // OTHER), password (PIN used, when applicable), electricQuantity (battery %) }.
  router.get('/locks/:address/operations', async (req, res) => {
    const address = req.params.address;
    const reload = req.query.reload === '1' || req.query.reload === 'true';
    if (reload) {
      const ops = await manager.getOperationLog(address, true);
      // false = BLE fetch failed; fall back to the persisted log rather than erroring.
      if (Array.isArray(ops)) return res.json({ operations: ops, reloaded: true });
    }
    res.json({ operations: manager.getPersistedOperationLog(address), reloaded: false });
  });

  // Add a passcode.
  router.post('/locks/:address/passcodes', async (req, res) => {
    const { passCode, startDate, endDate, type = 1 } = req.body || {};
    if (!isDigits(passCode)) return res.status(400).json({ error: 'passCode must be 4–9 digits' });
    if (!isTTLockDate(startDate) || !isTTLockDate(endDate)) {
      return res.status(400).json({ error: 'startDate/endDate must be YYYYMMDDHHmm (12 digits)' });
    }
    const result = await manager.addPasscode(req.params.address, type, passCode, startDate, endDate);
    if (result === false) {
      const detail = manager.getLastPasscodeError(req.params.address);
      return res.status(502).json({ error: detail ? detail.message : 'Add passcode failed' });
    }
    // null = added but list refresh failed — caller should re-fetch.
    res.json({ ok: true, passcodes: result === null ? null : result });
  });

  // Delete a passcode (type must match the one used at creation).
  router.delete('/locks/:address/passcodes', async (req, res) => {
    const { passCode, type = 1 } = req.body || {};
    if (!isDigits(passCode)) return res.status(400).json({ error: 'passCode must be 4–9 digits' });
    const result = await manager.deletePasscode(req.params.address, type, passCode);
    if (result === false) return res.status(502).json({ error: 'Delete passcode failed' });
    res.json({ ok: true, passcodes: result === null ? null : result });
  });

  return router;
}
