import express from 'express';
import manager from '../src/manager.js';
import door from '../src/door.js';

/** TTLock date strings are exactly 12 digits: YYYYMMDDHHmm */
function isTTLockDate(d) {
  return typeof d === 'string' && /^\d{12}$/.test(d);
}

/** Passcode must be digits only (4–9 per TTLock firmware). */
function isDigits(v) {
  return typeof v === 'string' && /^\d{4,9}$/.test(v);
}

/** ESP32 door codes: 4–8 digits (MIN_CODE_LEN/MAX_CODE_LEN du firmware). */
function isDoorCode(v) {
  return typeof v === 'string' && /^\d{4,8}$/.test(v);
}

/**
 * Convert a TTLock date string (YYYYMMDDHHmm, host-local wall clock) to Unix
 * UTC seconds — the format the ESP32 stores (DS3231 kept in UTC). Same wall
 * clock convention as the TTLock routes so the yk-immo platform sends one
 * single format everywhere.
 * @param {string} d
 * @returns {number}
 */
function ttlockDateToUnix(d) {
  return Math.floor(
    new Date(
      Number(d.slice(0, 4)),
      Number(d.slice(4, 6)) - 1,
      Number(d.slice(6, 8)),
      Number(d.slice(8, 10)),
      Number(d.slice(10, 12))
    ).getTime() / 1000
  );
}

/**
 * Map an ESP32 client error to the outbound response: firmware 4xx (payload
 * invalide, storage_full…) are forwarded as-is, anything else (timeout, refus
 * de connexion) becomes a 502 like the TTLock BLE failures.
 * @param {import('express').Response} res
 * @param {any} error
 */
function sendDoorError(res, error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 502;
  res.status(status).json({ error: error?.reason || error?.message || 'ESP32 unreachable' });
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

  // Update a passcode (change value and/or validity window). `type` must match
  // the one used at creation. Keep `newPassCode` = `passCode` to change only the
  // dates. BLE round-trip — may take several seconds.
  router.patch('/locks/:address/passcodes', async (req, res) => {
    const { passCode, newPassCode, startDate, endDate, type = 1 } = req.body || {};
    const next = newPassCode ?? passCode;
    if (!isDigits(passCode) || !isDigits(next)) {
      return res.status(400).json({ error: 'passCode/newPassCode must be 4–9 digits' });
    }
    if (!isTTLockDate(startDate) || !isTTLockDate(endDate)) {
      return res.status(400).json({ error: 'startDate/endDate must be YYYYMMDDHHmm (12 digits)' });
    }
    const result = await manager.updatePasscode(req.params.address, type, passCode, next, startDate, endDate);
    if (result === false) return res.status(502).json({ error: 'Update passcode failed' });
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

  // ── Porte d'entrée ESP32 (Wiegand) ────────────────────────────────────────
  // Mêmes conventions que les routes TTLock : dates YYYYMMDDHHmm (heure locale
  // de l'hôte), codes en chiffres. 503 si l'option door_host n'est pas
  // configurée dans l'addon.

  router.use('/door', (req, res, next) => {
    if (!door.isConfigured()) {
      return res.status(503).json({ error: 'Door controller not configured (door_host addon option)' });
    }
    next();
  });

  // Healthcheck / état (RTC, codes actifs, RSSI…).
  router.get('/door/status', async (req, res) => {
    try {
      res.json(await door.getStatus());
    } catch (error) {
      sendDoorError(res, error);
    }
  });

  // Journal des tentatives (boot, access_granted/denied, remote_open…).
  router.get('/door/logs', async (req, res) => {
    try {
      res.json(await door.getLogs());
    } catch (error) {
      sendDoorError(res, error);
    }
  });

  // Ouverture à distance (durée fixée par le firmware, RELAY_OPEN_MS).
  router.post('/door/open', async (req, res) => {
    try {
      res.json({ ok: true, ...(await door.open()) });
    } catch (error) {
      sendDoorError(res, error);
    }
  });

  // Provisionner un code clavier. Renvoyer le même code met à jour sa fenêtre.
  router.post('/door/codes', async (req, res) => {
    const { passCode, startDate, endDate, singleUse = false } = req.body || {};
    if (!isDoorCode(passCode)) return res.status(400).json({ error: 'passCode must be 4–8 digits' });
    if (!isTTLockDate(startDate) || !isTTLockDate(endDate)) {
      return res.status(400).json({ error: 'startDate/endDate must be YYYYMMDDHHmm (12 digits)' });
    }
    try {
      const result = await door.addCode({
        code: passCode,
        validFrom: ttlockDateToUnix(startDate),
        validUntil: ttlockDateToUnix(endDate),
        singleUse: singleUse === true
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      sendDoorError(res, error);
    }
  });

  // Révoquer un code (le hash est dérivé du code, comme dans le firmware).
  router.delete('/door/codes', async (req, res) => {
    const { passCode } = req.body || {};
    if (!isDoorCode(passCode)) return res.status(400).json({ error: 'passCode must be 4–8 digits' });
    try {
      res.json({ ok: true, ...(await door.deleteCode(passCode)) });
    } catch (error) {
      sendDoorError(res, error);
    }
  });

  return router;
}
