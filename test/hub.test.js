// -----------------------------------------------------------------------------
// The hub: states, scene events on transitions, the access switch, outages,
// configuration changes. Against the in-memory wg-easy built from real answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS, HUB_TIMINGS } from '../src/hub.js';
import { FEATURE_KEYS } from '../src/devices.js';
import {
  BASE_CONFIG,
  FakeWgEasy,
  HANDSHAKE,
  clientIdsOf,
  createAll,
  createClock,
  createWorld,
  serverFeatureId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  const alice = clientIdsOf(w.gladys, w.server, 'Alice phone');
  const laptop = clientIdsOf(w.gladys, w.server, 'Laptop');
  const events = (key) => w.fake.sceneEvents.filter((event) => event.key === key);
  return { ...w, alice, laptop, events };
}

const deviceOf = (w, ids) => w.fake.discoveredDevices.find((d) => d.external_id === ids.device);
const featureOf = (w, ids, key) =>
  deviceOf(w, ids).features.find((f) => f.external_id === ids.feature(key));

test('the first reading publishes the server, the clients and their states, without events', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.name),
    ['wg-easy 192.0.2.10:51821', 'Alice phone (VPN)', 'Laptop (VPN)'],
  );
  const state = (ids, key) => w.fake.lastState(ids.feature(key));
  assert.equal(state(w.alice, FEATURE_KEYS.CONNECTED), 1);
  assert.equal(state(w.alice, FEATURE_KEYS.ENABLED), 1);
  assert.equal(state(w.laptop, FEATURE_KEYS.CONNECTED), 0);
  assert.equal(state(w.laptop, FEATURE_KEYS.ENABLED), 0);
  assert.equal(state(w.laptop, FEATURE_KEYS.HANDSHAKE), 'Never');
  // 13:11 UTC, in the time zone of Gladys (Europe/Paris in the tests).
  assert.match(state(w.alice, FEATURE_KEYS.HANDSHAKE), /3:11/);
  assert.equal(w.fake.lastState(serverFeatureId(w.gladys, FEATURE_KEYS.CONNECTED_CLIENTS)), 1);
  assert.equal(w.fake.lastState(serverFeatureId(w.gladys, FEATURE_KEYS.CLIENTS)), 2);
  assert.deepEqual(w.fake.sceneEvents, []);
  for (const device of w.fake.discoveredDevices) {
    assert.equal(device.should_poll, false);
  }
});

test('traffic in megabytes, from the point of view of the client', async (t) => {
  const server = new FakeWgEasy();
  const w = await world(t, { server });
  server.handshake('Alice phone', HANDSHAKE, { rx: 2_500_000, tx: 12_340_000 });
  await w.hub.poll();
  // tx of the server = received by the client.
  assert.equal(w.fake.lastState(w.alice.feature(FEATURE_KEYS.RECEIVED)), 12.3);
  assert.equal(w.fake.lastState(w.alice.feature(FEATURE_KEYS.SENT)), 2.5);
  const feature = featureOf(w, w.alice, FEATURE_KEYS.RECEIVED);
  assert.equal(feature.unit, 'megabyte');
});

test('connected, then disconnected 3 minutes after the last handshake: one event each', async (t) => {
  const clock = createClock();
  const server = new FakeWgEasy();
  const w = await world(t, { clock, server });

  // The laptop gets enabled and connects.
  server.find('Laptop').enabled = true;
  server.handshake('Laptop', clock.now());
  await w.hub.poll();
  assert.deepEqual(w.events(TRIGGERS.CONNECTED), [
    {
      key: TRIGGERS.CONNECTED,
      data: { device: w.laptop.device, client: 'Laptop' },
    },
  ]);
  assert.equal(w.fake.lastState(w.laptop.feature(FEATURE_KEYS.CONNECTED)), 1);
  assert.equal(w.fake.lastState(serverFeatureId(w.gladys, FEATURE_KEYS.CONNECTED_CLIENTS)), 2);

  // Still connected while the handshakes keep coming.
  for (let i = 0; i < 5; i += 1) {
    clock.advance(120_000);
    server.handshake('Laptop', clock.now());
    server.handshake('Alice phone', clock.now());
    await w.hub.poll();
  }
  assert.equal(w.events(TRIGGERS.CONNECTED).length, 1);
  assert.equal(w.events(TRIGGERS.DISCONNECTED).length, 0);

  // The laptop goes silent: still connected 2 min 59 s later, not at 3 min.
  const last = clock.now();
  clock.advance(179_000);
  server.handshake('Alice phone', clock.now());
  await w.hub.poll();
  assert.equal(w.events(TRIGGERS.DISCONNECTED).length, 0);
  clock.time = last + 180_000;
  await w.hub.poll();
  const [event] = w.events(TRIGGERS.DISCONNECTED);
  assert.deepEqual(event.data, {
    device: w.laptop.device,
    client: 'Laptop',
    connected_minutes: 13,
  });
  assert.equal(w.fake.lastState(w.laptop.feature(FEATURE_KEYS.CONNECTED)), 0);
});

test('a client disabled in wg-easy counts as disconnected at once', async (t) => {
  const server = new FakeWgEasy();
  const w = await world(t, { server });
  server.find('Alice phone').enabled = false;
  await w.hub.poll();
  assert.equal(w.events(TRIGGERS.DISCONNECTED).length, 1);
  assert.equal(w.fake.lastState(w.alice.feature(FEATURE_KEYS.ENABLED)), 0);
});

test('only the changes are published, and everything again at the heartbeat', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const count = w.fake.states.length;
  await w.hub.poll();
  assert.equal(w.fake.states.length, count, 'nothing changed, nothing sent');
  clock.advance(HUB_TIMINGS.heartbeatMs);
  w.server.handshake('Alice phone', clock.now(), { rx: 0, tx: 0 });
  await w.hub.poll();
  assert.ok(w.fake.states.length - count >= 10, 'every value sent again');
});

test('a new client appears in the discovery; a removed one disappears', async (t) => {
  const server = new FakeWgEasy();
  const w = await world(t, { server });
  const [alice] = server.clients;
  server.clients.push({
    ...alice,
    id: 3,
    name: 'Tablet',
    publicKey: Buffer.alloc(32, 7).toString('base64'),
    latestHandshakeAt: null,
  });
  await w.hub.poll();
  assert.equal(w.fake.discoveredDevices.length, 4);
  server.clients.splice(2, 1);
  await w.hub.poll();
  assert.equal(w.fake.discoveredDevices.length, 3);
});

test('a device added in Gladys receives its states again', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.fake.deviceCreated(deviceOf(w, w.alice));
  const sent = w.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.equal(sent.length, 5);
  assert.ok(sent.every((id) => id.startsWith(`${w.alice.device}:`)));
});

test('the access switch is read only unless the configuration allows it', async (t) => {
  const w = await world(t);
  await createAll(w);
  const device = deviceOf(w, w.alice);
  const feature = featureOf(w, w.alice, FEATURE_KEYS.ENABLED);
  assert.equal(feature.read_only, true);
  const ack = await w.fake.setValue(device, feature, 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Allow enabling and disabling clients/);
  assert.equal(w.server.find('Alice phone').enabled, true, 'nothing sent to wg-easy');
});

test('control allowed: the switch disables and enables a client, read back at once', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, allow_control: true } });
  const device = deviceOf(w, w.alice);
  const feature = featureOf(w, w.alice, FEATURE_KEYS.ENABLED);
  assert.equal(feature.read_only, false);
  assert.equal((await w.fake.setValue(device, feature, 0)).success, true);
  assert.equal(w.server.find('Alice phone').enabled, false);
  assert.equal(w.fake.lastState(w.alice.feature(FEATURE_KEYS.ENABLED)), 0);
  assert.equal(w.events(TRIGGERS.DISCONNECTED).length, 1);
  assert.equal((await w.fake.setValue(device, feature, 1)).success, true);
  assert.equal(w.server.find('Alice phone').enabled, true);
  // Other features cannot be controlled.
  const connected = featureOf(w, w.alice, FEATURE_KEYS.CONNECTED);
  assert.equal((await w.fake.setValue(device, connected, 1)).success, false);
});

test('outage: one event after two silent readings, one when it answers again', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  w.server.online = false;
  await w.hub.poll();
  assert.equal(w.events(TRIGGERS.UNREACHABLE).length, 0, 'a blip is not an outage');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  clock.advance(15_000);
  await w.hub.poll();
  await w.hub.poll();
  assert.deepEqual(w.events(TRIGGERS.UNREACHABLE), [
    { key: TRIGGERS.UNREACHABLE, data: { error: 'wg-easy does not answer' } },
  ]);
  clock.advance(10 * 60_000);
  w.server.online = true;
  await w.hub.poll();
  assert.deepEqual(w.events(TRIGGERS.RECOVERED), [
    { key: TRIGGERS.RECOVERED, data: { down_minutes: 10 } },
  ]);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a refused password is reported in the status, without an outage event', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, password: 'wrong', language: 'fr' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /mot de passe refusé/);
  await w.hub.poll();
  await w.hub.poll();
  assert.equal(w.events(TRIGGERS.UNREACHABLE).length, 0);
  // Only the server device is offered, no client is known.
  assert.equal(w.fake.discoveredDevices.length, 1);
});

test('no address, or an address not understood', async (t) => {
  const empty = await world(t, { config: {} });
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.en, /Enter the address/);
  assert.deepEqual(empty.fake.discoveredDevices, []);
  const invalid = await world(t, { config: { url: 'ftp://nope' } });
  assert.match(invalid.fake.connectionStatus.message.en, /not understood/);
});

test('a new language republishes the handshake texts; new credentials start over', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...BASE_CONFIG, language: 'de' });
  assert.equal(w.fake.lastState(w.laptop.feature(FEATURE_KEYS.HANDSHAKE)), 'Nie');
  await w.fake.configUpdated({ ...BASE_CONFIG, language: 'de', password: 'other' });
  assert.equal(w.fake.connectionStatus.connected, false);
  // Back to the right password: no event for the clients found again.
  await w.fake.configUpdated({ ...BASE_CONFIG, language: 'de' });
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('"Test the connection" reports the version and the clients, or the error', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.en, 'wg-easy v15 answers: 2 client(s), 1 connected.');
  assert.equal(ack.data.message.fr, 'wg-easy v15 répond : 2 client(s), 1 connecté(s).');
  w.server.online = false;
  const down = await w.fake.action('test_connection', {});
  assert.equal(down.data.message.en, 'wg-easy does not answer');
});
