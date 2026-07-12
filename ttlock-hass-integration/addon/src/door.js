import { EventEmitter } from 'events';
import crypto from 'crypto';

/**
 * Client HTTP du contrôleur de porte d'entrée ESP32
 * (repo esp32-async-door-control-access).
 *
 * API du firmware (auth : `Authorization: Bearer <token>`) :
 *   POST   /open           → ouvre la gâche RELAY_OPEN_MS
 *   POST   /codes          → { code, valid_from, valid_until, single_use? } (Unix UTC)
 *   DELETE /codes/{hash}   → hash = 4 premiers octets du SHA-256 du code, en hex
 *   GET    /status         → { rtc_time, active_codes, stored_codes, wifi_rssi, … }
 *   GET    /logs           → { events: [{ ts, event, code_hash? }] }
 *
 * Singleton (même modèle que manager) : configuré par init.js, consommé par
 * ha.js (entités MQTT) et api/external.js (plateforme yk-immo).
 *
 * Événements émis :
 *   'status'        (statusObject)  — après chaque poll réussi
 *   'availability'  (boolean)       — uniquement sur transition online/offline
 */
class Esp32Door extends EventEmitter {
  constructor() {
    super();
    this.host = '';
    this.token = '';
    this.pollIntervalMs = 60000;
    this.requestTimeoutMs = 5000;
    /** @type {object|null} dernier /status reçu (pour republication MQTT) */
    this.lastStatus = null;
    /** @type {boolean|null} null = jamais pollé */
    this.online = null;
    this._pollTimer = null;
  }

  /**
   * @param {Object} options
   * @param {string} options.host IP ou hôte de l'ESP32 (préférer une IP fixe :
   *   le mDNS `.local` ne résout pas toujours depuis le conteneur)
   * @param {string} options.token API_TOKEN du firmware (secrets.h)
   * @param {number} [options.pollIntervalMs]
   */
  configure({ host, token, pollIntervalMs }) {
    this.host = String(host ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    // bashio::config renvoie parfois la chaîne littérale "null" pour une
    // option absente — équivalent à non configuré.
    if (this.host === 'null') this.host = '';
    this.token = String(token ?? '').trim();
    if (Number.isInteger(pollIntervalMs) && pollIntervalMs >= 5000) {
      this.pollIntervalMs = pollIntervalMs;
    }
    if (this.host && !this.token) {
      console.warn('[Door] door_host configuré sans door_token — les requêtes seront refusées (401) par l\'ESP32.');
    }
  }

  isConfigured() {
    return this.host.length > 0;
  }

  /** Même dérivation que AccessStore::hashCode : SHA-256 tronqué à 4 octets, hex. */
  static hashCode(code) {
    return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex').slice(0, 8);
  }

  /**
   * Requête vers l'ESP32. Résout avec le JSON décodé ; rejette avec une Error
   * portant `status` (HTTP) et `reason` (champ d'erreur du firmware) si dispo.
   * @param {string} method
   * @param {string} path
   * @param {object} [body]
   */
  async _request(method, path, body) {
    const url = `http://${this.host}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // corps vide ou non-JSON : data reste null
    }
    if (!res.ok) {
      const err = new Error(`ESP32 ${method} ${path} → HTTP ${res.status}${data?.reason ? ` (${data.reason})` : ''}`);
      err.status = res.status;
      err.reason = data?.reason;
      throw err;
    }
    return data;
  }

  /** Ouvre la porte (durée = RELAY_OPEN_MS côté firmware). */
  async open() {
    return this._request('POST', '/open');
  }

  /**
   * Provisionne (ou met à jour, même code = même hash) un code clavier.
   * @param {Object} p
   * @param {string} p.code 4–8 chiffres
   * @param {number} p.validFrom Unix UTC (secondes)
   * @param {number} p.validUntil Unix UTC (secondes)
   * @param {boolean} [p.singleUse]
   */
  async addCode({ code, validFrom, validUntil, singleUse = false }) {
    return this._request('POST', '/codes', {
      code: String(code),
      valid_from: validFrom,
      valid_until: validUntil,
      single_use: singleUse
    });
  }

  /** Révoque un code (le firmware ne stocke que le hash). */
  async deleteCode(code) {
    return this._request('DELETE', `/codes/${Esp32Door.hashCode(code)}`);
  }

  async getStatus() {
    return this._request('GET', '/status');
  }

  async getLogs() {
    return this._request('GET', '/logs');
  }

  /** Poll périodique du /status : alimente les capteurs HA + availability. */
  startPolling() {
    if (!this.isConfigured() || this._pollTimer) return;
    const poll = async () => {
      try {
        const status = await this.getStatus();
        this.lastStatus = status;
        this._setOnline(true);
        this.emit('status', status);
      } catch (error) {
        this._setOnline(false);
        if (process.env.DOOR_DEBUG == '1') {
          console.warn('[Door] Poll /status échoué :', error.message);
        }
      }
    };
    this._pollTimer = setInterval(poll, this.pollIntervalMs);
    // unref : le timer ne doit pas empêcher les tests / l'arrêt du process
    if (typeof this._pollTimer.unref === 'function') this._pollTimer.unref();
    poll();
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    console.log(`[Door] ESP32 porte d'entrée ${online ? 'joignable' : 'INJOIGNABLE'} (${this.host})`);
    this.emit('availability', online);
  }
}

export default new Esp32Door();
