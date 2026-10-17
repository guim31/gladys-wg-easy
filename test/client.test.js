// -----------------------------------------------------------------------------
// The wg-easy client against the in-memory server built from real answers:
// API generation detection, normalization, errors by kind, commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMAND_ERRORS,
  ERROR_KINDS,
  WgEasyClient,
  keyId,
  normalizeClient,
} from '../src/wgeasy/client.js';
import { FIXTURES, FakeWgEasy, createNetwork } from './helpers/fakeWgEasy.js';

const URL = 'http://192.0.2.10:51821';

function clientFor(server, options = {}) {
  const network = createNetwork({ [URL]: server });
  return new WgEasyClient({
    url: URL,
    username: 'admin',
    password: 'secret',
    request: network.request,
    ...options,
  });
}

const rejectsWith = (promise, kind) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    return true;
  });

test('a v15 client of the real answer, normalized', () => {
  const [alice, laptop] = FIXTURES.v15.map(normalizeClient);
  assert.deepEqual(alice, {
    id: '1',
    key: keyId(FIXTURES.v15[0].publicKey),
    name: 'Alice phone',
    enabled: true,
    address: '10.8.0.2',
    handshakeAt: Date.parse('2026-10-17T13:11:22.000Z'),
    rx: 404,
    tx: 348,
    expiresAt: null,
  });
  // Disabled: not in `wg show dump`, no live data.
  assert.equal(laptop.enabled, false);
  assert.equal(laptop.handshakeAt, null);
  assert.equal(laptop.rx, null);
});

test('a v14 client keeps the identity of its key across a migration to v15', () => {
  const [v14] = FIXTURES.v14.map(normalizeClient);
  assert.equal(v14.id, FIXTURES.v14[0].id);
  assert.equal(v14.address, '10.8.0.2');
  // Same key as the v15 fixture of the same client: same device in Gladys.
  assert.equal(v14.key, normalizeClient(FIXTURES.v15[0]).key);
  assert.match(v14.key, /^[0-9a-f]{64}$/);
});

test('a client without a valid public key is skipped', () => {
  assert.equal(normalizeClient({ ...FIXTURES.v15[0], publicKey: 'nope' }), null);
  assert.equal(normalizeClient(null), null);
  assert.equal(keyId('not base64 at all'), null);
});

test('v15: basic authentication, the generation is found and remembered', async () => {
  const server = new FakeWgEasy();
  const client = clientFor(server);
  const clients = await client.listClients();
  assert.equal(client.version, 15);
  assert.equal(clients.length, 2);
  const [request] = server.requests;
  assert.equal(request.pathname, '/api/client');
  assert.equal(
    request.headers.authorization,
    `Basic ${Buffer.from('admin:secret').toString('base64')}`,
  );
});

test('v14: the password in the Authorization header, found after the v15 attempt', async () => {
  const server = new FakeWgEasy({ version: 14 });
  const client = clientFor(server);
  assert.equal((await client.listClients()).length, 1);
  assert.equal(client.version, 14);
  assert.deepEqual(
    server.requests.map((r) => r.pathname),
    ['/api/client', '/api/wireguard/client'],
  );
  assert.equal(server.requests[1].headers.authorization, 'secret');
  // Remembered: one request next time.
  server.requests.length = 0;
  await client.listClients();
  assert.equal(server.requests.length, 1);
});

test('v14 without password: no header at all', async () => {
  const server = new FakeWgEasy({ version: 14, password: '' });
  const client = clientFor(server, { password: '' });
  await client.listClients();
  assert.equal(client.version, 14);
  assert.equal(server.requests.at(-1).headers.authorization, undefined);
});

test('a refused password is an authentication error, on v15 and on v14 (HTTP 500)', async () => {
  await rejectsWith(
    clientFor(new FakeWgEasy(), { password: 'wrong' }).listClients(),
    ERROR_KINDS.AUTH,
  );
  await rejectsWith(
    clientFor(new FakeWgEasy({ version: 14 }), { password: 'wrong' }).listClients(),
    ERROR_KINDS.AUTH,
  );
  await rejectsWith(clientFor(new FakeWgEasy(), { password: '' }).listClients(), ERROR_KINDS.AUTH);
  // Two-factor authentication on: wg-easy refuses basic authentication.
  await rejectsWith(clientFor(new FakeWgEasy({ totp: true })).listClients(), ERROR_KINDS.AUTH);
});

test('no answer, a redirect, a certificate, something else than wg-easy', async () => {
  const silent = new FakeWgEasy();
  silent.online = false;
  await rejectsWith(clientFor(silent).listClients(), ERROR_KINDS.UNREACHABLE);

  const redirect = { handle: async () => ({ status: 301, headers: {}, body: '' }) };
  await rejectsWith(clientFor(redirect).listClients(), ERROR_KINDS.REDIRECT);

  const tls = {
    handle: async () => {
      const error = new Error('self-signed certificate');
      error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT';
      throw error;
    },
  };
  await rejectsWith(clientFor(tls).listClients(), ERROR_KINDS.TLS);

  const other = { handle: async () => ({ status: 404, headers: {}, body: '<html></html>' }) };
  await rejectsWith(clientFor(other).listClients(), ERROR_KINDS.NOT_WGEASY);

  const forbidden = {
    handle: async () => ({
      status: 403,
      headers: {},
      body: JSON.stringify({ statusMessage: 'Password authentication is disabled' }),
    }),
  };
  await rejectsWith(clientFor(forbidden).listClients(), ERROR_KINDS.FORBIDDEN);
});

test('enable and disable a client, on v15 and v14', async () => {
  for (const version of [15, 14]) {
    const server = new FakeWgEasy({ version });
    const client = clientFor(server);
    const [first] = await client.listClients();
    await client.setEnabled(first.id, false);
    assert.equal(server.clients[0].enabled, false, `v${version} disabled`);
    await client.setEnabled(first.id, true);
    assert.equal(server.clients[0].enabled, true, `v${version} enabled`);
    const last = server.requests.at(-1);
    assert.equal(last.method, 'POST');
    assert.match(last.pathname, /\/enable$/);
  }
});

test('commands: an unknown client (v14), an expired client (v15)', async () => {
  const v14 = clientFor(new FakeWgEasy({ version: 14 }));
  await v14.listClients();
  await rejectsWith(v14.setEnabled('nope', true), COMMAND_ERRORS.UNKNOWN_CLIENT);

  const expired = {
    handle: async (url) =>
      url.endsWith('/enable')
        ? {
            status: 422,
            headers: {},
            body: JSON.stringify({
              statusCode: 422,
              message: 'Client is expired. Please update the expiration date first.',
            }),
          }
        : { status: 200, headers: {}, body: JSON.stringify(FIXTURES.v15) },
  };
  const v15 = clientFor(expired);
  await v15.listClients();
  await rejectsWith(v15.setEnabled('1', true), COMMAND_ERRORS.EXPIRED);
});

test('the password never appears in an error message', async () => {
  const silent = new FakeWgEasy();
  silent.online = false;
  const err = await clientFor(silent, { password: 'top-secret' })
    .listClients()
    .catch((e) => e);
  assert.ok(!err.message.includes('top-secret'));
});

test('a proxy in front of a stopped wg-easy (502, 503, 504) means unreachable', async () => {
  for (const status of [502, 503, 504]) {
    const proxy = { handle: async () => ({ status, headers: {}, body: 'Bad Gateway' }) };
    await rejectsWith(clientFor(proxy).listClients(), ERROR_KINDS.UNREACHABLE);
  }
});

test('v14: a 500 after the password was accepted is an error, not a refusal', async () => {
  const server = new FakeWgEasy({ version: 14 });
  const client = clientFor(server);
  await client.listClients();
  server.handle14 = () => ({ status: 500, headers: {}, body: '{"statusCode":500}' });
  await rejectsWith(client.listClients(), ERROR_KINDS.HTTP);
});

test('v14: a password Node cannot put in a header is reported as such', async () => {
  const server = new FakeWgEasy({ version: 14 });
  await rejectsWith(clientFor(server, { password: 'pass€' }).listClients(), ERROR_KINDS.AUTH);
});
