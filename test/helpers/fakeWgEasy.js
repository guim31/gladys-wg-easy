// -----------------------------------------------------------------------------
// An in-memory wg-easy, v15 or v14, answering like the real ones recorded in
// test/fixtures/wg-easy (wg-easy 15.4.0 and 14 in Docker): status codes,
// error bodies, client shapes. Plugged into the client through its `request`
// seam: no network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/wg-easy/${name}.json`, import.meta.url), 'utf8'));

export const FIXTURES = {
  v15: fixture('v15-clients'),
  v15NoHandshake: fixture('v15-clients-no-handshake'),
  v15Errors: fixture('v15-errors'),
  v14: fixture('v14-clients'),
  v14Errors: fixture('v14-errors'),
};

const json = (status, data) => ({ status, headers: {}, body: JSON.stringify(data) });

export class FakeWgEasy {
  /**
   * @param {object} [options]
   * @param {15|14} [options.version]
   * @param {string} [options.username]
   * @param {string} [options.password] '' on v14: no password asked
   * @param {Array} [options.clients] raw clients (default: the fixture of the version)
   * @param {boolean} [options.totp] v15: the user has two-factor authentication on
   */
  constructor({
    version = 15,
    username = 'admin',
    password = 'secret',
    clients,
    totp = false,
  } = {}) {
    this.version = version;
    this.username = username;
    this.password = password;
    this.totp = totp;
    this.clients = structuredClone(clients ?? (version === 15 ? FIXTURES.v15 : FIXTURES.v14));
    this.online = true;
    this.requests = [];
  }

  /** The raw client named `name`. */
  find(name) {
    return this.clients.find((client) => client.name === name);
  }

  /** A handshake at `time` (ms), with some traffic. */
  handshake(name, time, { rx = 1_000, tx = 2_000 } = {}) {
    const client = this.find(name);
    client.latestHandshakeAt = new Date(time).toISOString();
    client.transferRx = (client.transferRx ?? 0) + rx;
    client.transferTx = (client.transferTx ?? 0) + tx;
  }

  authorized(headers) {
    const header = headers.authorization;
    if (this.version === 14) {
      return this.password === '' || header === this.password;
    }
    const expected = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    return header === expected && !this.totp;
  }

  async handle(url, { method = 'GET', headers = {} } = {}) {
    const { pathname } = new URL(url);
    this.requests.push({ method, pathname, headers });
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    return this.version === 15
      ? this.handle15(method, pathname, headers)
      : this.handle14(method, pathname, headers);
  }

  handle15(method, pathname, headers) {
    const errors = FIXTURES.v15Errors;
    if (!pathname.startsWith('/api/client')) {
      return json(404, errors.v14_path);
    }
    if (!headers.authorization) {
      return json(401, errors.no_authorization);
    }
    if (!this.authorized(headers)) {
      return json(401, errors.unauthorized);
    }
    if (method === 'GET' && pathname === '/api/client') {
      return json(
        200,
        this.clients.map((client) =>
          client.enabled
            ? client
            : // A disabled client is not in `wg show dump`: no live data.
              {
                ...client,
                latestHandshakeAt: null,
                endpoint: null,
                transferRx: null,
                transferTx: null,
              },
        ),
      );
    }
    const match = pathname.match(/^\/api\/client\/(\d+)\/(enable|disable)$/);
    if (method === 'POST' && match) {
      const client = this.clients.find((c) => String(c.id) === match[1]);
      // wg-easy 15.4 answers 200 for an unknown id too.
      if (client) {
        client.enabled = match[2] === 'enable';
      }
      return json(200, { success: true });
    }
    return json(404, errors.v14_path);
  }

  handle14(method, pathname, headers) {
    const errors = FIXTURES.v14Errors;
    if (!this.authorized(headers)) {
      // The v14 middleware crashes instead of answering 401.
      return json(500, errors.unauthorized);
    }
    if (method === 'GET' && pathname === '/api/wireguard/client') {
      return json(200, this.clients);
    }
    const match = pathname.match(/^\/api\/wireguard\/client\/([^/]+)\/(enable|disable)$/);
    if (method === 'POST' && match) {
      const client = this.clients.find((c) => c.id === match[1]);
      if (!client) {
        return json(404, errors.unknown_client);
      }
      client.enabled = match[2] === 'enable';
      return json(200, { success: true });
    }
    // The v14 router has no catch-all for /api: the static server answers.
    return { status: 404, headers: {}, body: 'Not Found' };
  }
}

/** A request function serving fake servers by origin; others refuse the connection. */
export function createNetwork(servers) {
  return {
    servers,
    request(url, options) {
      const server = servers[new URL(url).origin];
      if (!server) {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        return Promise.reject(error);
      }
      return server.handle(url, options);
    },
  };
}
