// -----------------------------------------------------------------------------
// Several wg-easy servers (forum t/11334): the one of the configuration keeps
// the ids of 1.0.0, the ones added by the action get their own server device,
// their clients, their events and their outages; kept in /data, removed by
// the action.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { CLIENT_TYPE, FEATURE_KEYS, SERVER_TYPE } from '../src/devices.js';
import { keyId } from '../src/wgeasy/client.js';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  FIXTURES,
  FakeWgEasy,
  createAll,
  createClock,
  createWorld,
  serverDeviceId,
} from './helpers/world.js';

const URL_2 = 'http://192.0.2.20:51821';
const OFFICE_KEY = Buffer.alloc(32, 7).toString('base64');

/** A second wg-easy, with a client of its own (another public key). */
function officeServer() {
  const client = {
    ...structuredClone(FIXTURES.v15[0]),
    id: 9,
    name: 'Office laptop',
    publicKey: OFFICE_KEY,
    // Not connected at the first reading.
    latestHandshakeAt: null,
  };
  return new FakeWgEasy({ password: 'other', clients: [client] });
}

async function twoServers(t, options = {}) {
  const office = officeServer();
  const clock = createClock();
  const w = await createWorld({ clock, servers: { [URL_2]: office }, ...options });
  t.after(() => w.app.stop());
  const ack = await w.fake.action('add_server', {
    url: '192.0.2.20:51821',
    username: 'admin',
    password: 'other',
  });
  return { ...w, office, clock, ack };
}

const officeDevice = (gladys) => gladys.externalIds(CLIENT_TYPE, keyId(OFFICE_KEY)).device;

test('a second server: its own server device and clients, the first keeps its ids', async (t) => {
  const w = await twoServers(t);
  assert.equal(
    w.ack.data.message.en,
    'wg-easy 192.0.2.20:51821 added.\nIt answers: 1 client(s). Open the Discover tab to add them.',
  );
  const ids = w.fake.discoveredDevices.map((device) => device.external_id);
  assert.ok(ids.includes(serverDeviceId(w.gladys)), 'server 1 unchanged');
  assert.ok(ids.includes(w.gladys.externalIds(SERVER_TYPE, '2').device));
  assert.ok(ids.includes(officeDevice(w.gladys)));
  assert.equal(w.fake.discoveredDevices.length, 5);
  // Kept in /data, for the next start; the password never in the logs.
  const saved = JSON.parse(await readFile(join(w.dataDir, 'servers.json'), 'utf8'));
  assert.deepEqual(
    saved.servers.map((entry) => [entry.id, entry.url]),
    [['2', URL_2]],
  );
  const report = await w.fake.action('list_servers', {});
  assert.equal(
    report.data.message.en,
    [
      'wg-easy 192.0.2.10:51821: wg-easy v15 answers: 2 client(s), 1 connected.',
      'wg-easy 192.0.2.20:51821: wg-easy v15 answers: 1 client(s), 0 connected.',
    ].join('\n'),
  );

  const again = await createWorld({
    servers: { [URL_2]: officeServer() },
    dataDir: w.dataDir,
  });
  t.after(() => again.app.stop());
  assert.ok(
    again.fake.discoveredDevices.some(
      (device) => device.external_id === officeDevice(again.gladys),
    ),
    'the added server comes back at the next start',
  );
});

test('the events of a client say its server; filters by server device', async (t) => {
  const w = await twoServers(t);
  await createAll(w);
  w.office.find('Office laptop').enabled = true;
  w.office.handshake('Office laptop', w.clock.now());
  await w.hub.poll();
  const [event] = w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.CONNECTED);
  assert.deepEqual(event.data, {
    device: officeDevice(w.gladys),
    client: 'Office laptop',
    server: 'wg-easy 192.0.2.20:51821',
    server_device: w.gladys.externalIds(SERVER_TYPE, '2').device,
  });
  assert.equal(
    w.fake.lastState(
      w.gladys.externalIds(CLIENT_TYPE, keyId(OFFICE_KEY)).feature(FEATURE_KEYS.CONNECTED),
    ),
    1,
  );
});

test('one server down: the other still read, the status and the widget name it', async (t) => {
  const w = await twoServers(t);
  w.office.online = false;
  await w.hub.poll();
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(
    w.fake.connectionStatus.message.en,
    'wg-easy 192.0.2.20:51821: wg-easy does not answer',
  );
  assert.equal(w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.UNREACHABLE).length, 1);
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  const status = ack.data.content.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items[0], {
    label: 'wg-easy 192.0.2.20:51821',
    icon: 'alert-triangle',
    value: 'wg-easy does not answer',
    color: 'warning',
  });
  assert.ok(
    status.items.some((item) => item.label === 'Alice phone'),
    'server 1 still listed',
  );
});

test('remove a server; the configuration one, a wrong address, a known one', async (t) => {
  const w = await twoServers(t);
  const config = await w.fake.action('remove_server', { server: '192.0.2.10:51821' });
  assert.match(config.data.message.en, /server of the configuration: empty its address there/);
  const unknown = await w.fake.action('remove_server', { server: 'nowhere' });
  assert.match(unknown.data.message.en, /^No server "nowhere"\. Servers: wg-easy 192\.0\.2\.10/);
  const inConfig = await w.fake.action('add_server', { url: 'http://192.0.2.10:51821' });
  assert.match(inConfig.data.message.en, /server of the configuration: change it there/);
  const invalid = await w.fake.action('add_server', { url: 'ftp://x' });
  assert.match(invalid.data.message.en, /Address not understood/);
  // Added again: updated, same id.
  const updated = await w.fake.action('add_server', { url: URL_2, password: 'other' });
  assert.match(updated.data.message.en, /^wg-easy 192\.0\.2\.20:51821 updated\./);
  const removed = await w.fake.action('remove_server', { server: 'http://192.0.2.20:51821/' });
  assert.equal(
    removed.data.message.en,
    'wg-easy 192.0.2.20:51821 removed. Delete its devices in Gladys if needed.',
  );
  assert.equal(w.fake.discoveredDevices.length, 3);
  assert.equal(w.fake.connectionStatus.connected, true);
  // Its id is never given again.
  await w.fake.action('add_server', { url: URL_2, password: 'other' });
  const saved = JSON.parse(await readFile(join(w.dataDir, 'servers.json'), 'utf8'));
  assert.deepEqual(
    saved.servers.map((entry) => entry.id),
    ['3'],
  );
});

test('the password of an added server never reaches the logs', async (t) => {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  const w = await twoServers(t);
  w.office.online = false;
  await w.hub.poll();
  assert.ok(lines.length > 0);
  assert.ok(
    lines.every((line) => !line.includes('other')),
    lines.join('\n'),
  );
});

test('review: a server down publishes nothing; removed, its clients go disconnected', async (t) => {
  const w = await twoServers(t);
  await createAll(w);
  const office = w.gladys.externalIds(CLIENT_TYPE, keyId(OFFICE_KEY));
  w.office.find('Office laptop').enabled = true;
  w.office.handshake('Office laptop', w.clock.now());
  await w.hub.poll();
  assert.equal(w.fake.lastState(office.feature(FEATURE_KEYS.CONNECTED)), 1);
  // Down, then read on while server 1 answers: no state of its client changes
  // without an event (it is unknown, not disconnected).
  w.office.online = false;
  w.clock.advance(10 * 60_000);
  await w.hub.poll();
  await w.hub.poll();
  assert.equal(w.fake.lastState(office.feature(FEATURE_KEYS.CONNECTED)), 1);
  assert.equal(
    w.fake.sceneEvents.filter(
      (e) => e.key === TRIGGERS.DISCONNECTED && e.data.device === office.device,
    ).length,
    0,
  );
  // Removed: its device stays in Gladys, disconnected and unreachable.
  w.office.online = true;
  w.office.handshake('Office laptop', w.clock.now());
  await w.hub.poll();
  await w.fake.action('remove_server', { server: URL_2 });
  assert.equal(w.fake.lastState(office.feature(FEATURE_KEYS.CONNECTED)), 0);
  const last = w.fake.transports
    .filter((entry) => entry.device_external_id === office.device)
    .at(-1);
  assert.equal(last.transport, 'unreachable');
});

test('review: a client moving to another server fires no event', async (t) => {
  // The same client on both servers (a configuration copied): server 1 owns it.
  const shared = structuredClone(FIXTURES.v15[0]);
  const w = await createWorld({
    servers: { [URL_2]: new FakeWgEasy({ password: 'other', clients: [shared] }) },
  });
  t.after(() => w.app.stop());
  await w.fake.action('add_server', { url: URL_2, password: 'other' });
  const owners = w.hub.servers.map((server) => server.clients.size);
  assert.deepEqual(owners, [2, 0], 'server 1 keeps the shared client');
  // Server 1 gone from the configuration: server 2 takes the client, silently.
  await w.app.hub.reconfigure({ ...w.hub.config, url: null });
  await w.hub.poll();
  assert.equal(w.hub.servers[0].clients.size, 1);
  assert.equal(w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.CONNECTED).length, 0);
});

test('review: an unreadable servers.json is set aside, ids never start over at 2', async (t) => {
  const { writeFile } = await import('node:fs/promises');
  const dataDir = (await createWorld({ connect: false })).dataDir;
  await writeFile(join(dataDir, 'servers.json'), '{ not json');
  const w = await createWorld({ dataDir, servers: { [URL_2]: officeServer() } });
  t.after(() => w.app.stop());
  await w.fake.action('add_server', { url: URL_2, password: 'other' });
  const saved = JSON.parse(await readFile(join(dataDir, 'servers.json'), 'utf8'));
  assert.deepEqual(
    saved.servers.map((entry) => entry.id),
    ['1001'],
  );
});
