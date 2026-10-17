// -----------------------------------------------------------------------------
// wg-easy API client, v15 and v14 (the two API generations still in use).
//
// v15 (15.0 to 15.4, SQLite, several users): `GET /api/client`, enable and
// disable by `POST /api/client/{id}/enable|disable`. Every request carries
// HTTP basic authentication (user name and password of a wg-easy user,
// `getCurrentUser` of server/utils/session.ts): no session to keep, nothing to
// log out. wg-easy refuses basic authentication to a user with two-factor
// authentication on, and to everyone when DISABLE_PASSWORD_AUTH is set.
//
// v14 (one password, no user): `GET /api/wireguard/client`, enable and disable
// under `/api/wireguard/client/{id}/`, the password itself in the
// Authorization header (no scheme). Without PASSWORD_HASH, no header at all.
// A refused or missing password answers HTTP 500, not 401 (its middleware
// calls an Express `res.status` that h3 does not have; seen on 14 in Docker),
// and so does any v15 path on a v14.
//
// The generation is found by trying v15 first, then v14, and remembered; a 404
// later on makes the client look again (the server was upgraded).
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // wrong or missing password, or two-factor authentication on
  FORBIDDEN: 'forbidden', // password login disabled, user disabled
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  NOT_WGEASY: 'not_wgeasy', // something answers, not a wg-easy API
  HTTP: 'http', // any other HTTP error
});

// Errors of a command on one client (not a reason to mark the server down).
export const COMMAND_ERRORS = Object.freeze({
  EXPIRED: 'expired', // v15: the client has expired, wg-easy refuses to enable it
  UNKNOWN_CLIENT: 'unknown_client', // removed from wg-easy meanwhile
});

export class WgEasyError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS or COMMAND_ERRORS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'WgEasyError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new WgEasyError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new WgEasyError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

const toTime = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
};

const toBytes = (value) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null;
};

/**
 * The stable identity of a client: its WireGuard public key (32 bytes,
 * base64), in hexadecimal. It survives a migration from v14 to v15, which
 * changes the client ids (uuid to number) but keeps the keys.
 * @returns {string|null}
 */
export function keyId(publicKey) {
  if (typeof publicKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) {
    return null;
  }
  return Buffer.from(publicKey, 'base64').toString('hex');
}

/**
 * One client of either API generation, in one shape.
 * @returns {{ id: string, key: string, name: string, enabled: boolean,
 *   address: string|null, handshakeAt: number|null, rx: number|null,
 *   tx: number|null, expiresAt: number|null }|null}
 */
export function normalizeClient(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const key = keyId(raw.publicKey);
  if (key === null || raw.id === undefined || raw.id === null) {
    return null;
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : String(raw.id);
  return {
    id: String(raw.id),
    key,
    name,
    enabled: raw.enabled === true || raw.enabled === 1,
    address: raw.ipv4Address ?? raw.address ?? null,
    handshakeAt: toTime(raw.latestHandshakeAt),
    // Seen from the server: rx is what the client sent (its upload), tx what
    // it received (its download). Null before the first handshake.
    rx: toBytes(raw.transferRx),
    tx: toBytes(raw.transferTx),
    expiresAt: toTime(raw.expiresAt),
  };
}

const PATHS = {
  15: { list: '/api/client', client: (id) => `/api/client/${encodeURIComponent(id)}` },
  14: {
    list: '/api/wireguard/client',
    client: (id) => `/api/wireguard/client/${encodeURIComponent(id)}`,
  },
};

export class WgEasyClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port]`
   * @param {string} options.username wg-easy user (v15)
   * @param {string} options.password
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/wgeasy/http.js)
   */
  constructor({ url, username, password, insecure = false, request = httpRequest }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.insecure = insecure;
    this.request = request;
    /** 15 or 14 once known. */
    this.version = null;
    /** These credentials were accepted at least once. */
    this.accepted = false;
  }

  headers(version) {
    if (!this.password) {
      return {};
    }
    if (version === 15) {
      const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      return { authorization: `Basic ${token}` };
    }
    return { authorization: this.password };
  }

  async call(version, path, { method = 'GET' } = {}) {
    // Node refuses a header with characters outside Latin-1 (v14 sends the
    // password as is): say so, rather than a network error.
    if (version === 14 && /[^\t\x20-\x7e\x80-\xff]/.test(this.password)) {
      throw new WgEasyError(ERROR_KINDS.AUTH, 'Password not usable in an HTTP header');
    }
    const headers = this.headers(version);
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        method,
        headers,
        insecure: this.insecure,
        // A POST without body: h3 then reads no JSON.
        ...(method === 'POST' ? { json: {} } : {}),
      });
    } catch (err) {
      throw networkError(err);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new WgEasyError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    return { status: response.status, data: parseJson(response.body) };
  }

  /**
   * Every client of the server (all of them for an admin, the user's own on
   * v15 otherwise).
   * @returns {Promise<Array<ReturnType<typeof normalizeClient>>>}
   */
  async listClients() {
    const order = this.version === 14 ? [14, 15] : [15, 14];
    const statuses = [];
    for (const version of order) {
      const { status, data } = await this.call(version, PATHS[version].list);
      if (status === 200 && Array.isArray(data)) {
        this.version = version;
        this.accepted = true;
        return data.map(normalizeClient).filter(Boolean);
      }
      if ([502, 503, 504].includes(status)) {
        // A reverse proxy in front of a stopped wg-easy.
        throw new WgEasyError(ERROR_KINDS.UNREACHABLE, `Proxy answers HTTP ${status}`, {
          status,
        });
      }
      if (status === 403) {
        throw new WgEasyError(ERROR_KINDS.FORBIDDEN, 'Access refused (HTTP 403)', { status });
      }
      statuses.push(status);
    }
    this.version = null;
    // A v14 refuses a password with a 500, but also fails with a 500 when
    // WireGuard does: once these credentials were accepted, a 500 is an error.
    const v14Status = statuses[order.indexOf(14)];
    if (statuses.includes(401) || (v14Status === 500 && !this.accepted)) {
      throw new WgEasyError(ERROR_KINDS.AUTH, 'Credentials refused (HTTP 401)', { status: 401 });
    }
    const [first] = statuses;
    if (statuses.every((status) => status === 404 || status === 200)) {
      throw new WgEasyError(ERROR_KINDS.NOT_WGEASY, 'No wg-easy API at this address', {
        status: first,
      });
    }
    throw new WgEasyError(ERROR_KINDS.HTTP, `HTTP ${first}`, { status: first });
  }

  /** Enable or disable a client (its id in the current API generation). */
  async setEnabled(id, enabled) {
    if (this.version === null) {
      await this.listClients();
    }
    const path = `${PATHS[this.version].client(id)}/${enabled ? 'enable' : 'disable'}`;
    const { status, data } = await this.call(this.version, path, { method: 'POST' });
    if (status === 200) {
      return;
    }
    if (status === 401) {
      throw new WgEasyError(ERROR_KINDS.AUTH, 'Credentials refused (HTTP 401)', { status });
    }
    if (status === 403) {
      throw new WgEasyError(ERROR_KINDS.FORBIDDEN, 'Access refused (HTTP 403)', { status });
    }
    if (status === 422 && /expired/i.test(data?.message ?? data?.statusMessage ?? '')) {
      throw new WgEasyError(COMMAND_ERRORS.EXPIRED, 'Client expired', { status });
    }
    if (status === 404) {
      // v14 only: v15 answers 200 for an unknown id (seen on 15.4).
      throw new WgEasyError(COMMAND_ERRORS.UNKNOWN_CLIENT, `Client not found (HTTP ${status})`, {
        status,
      });
    }
    throw new WgEasyError(ERROR_KINDS.HTTP, `HTTP ${status}`, { status });
  }
}
