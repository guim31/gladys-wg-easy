// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2 never polls a device
// published with should_poll: false (and never polls the devices created
// without should_poll, GladysAssistant/Gladys#3198): wg-easy must be read by
// the hub's own timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import {
  BASE_CONFIG,
  FakeWgEasy,
  clientIdsOf,
  createAll,
  createClock,
  createWorld,
} from './helpers/world.js';

/** Let the timer callback and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test('the internal timer reads wg-easy without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const server = new FakeWgEasy();
  const w = await createWorld({
    clock,
    server,
    config: { ...BASE_CONFIG, poll_interval: '60' },
    timers: true,
  });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  assert.ok(w.fake.discoveredDevices.every((device) => device.should_poll === false));
  const reads = () => server.requests.length;
  const before = reads();

  // Alice goes silent: disconnected after 3 minutes, seen by the timer alone.
  for (let i = 0; i < 4; i += 1) {
    clock.advance(60_000);
    t.mock.timers.tick(60_000);
    await settle();
  }
  assert.equal(reads() - before, 4, 'one reading per interval');
  const alice = clientIdsOf(w.gladys, server, 'Alice phone');
  assert.equal(w.fake.lastState(alice.feature(FEATURE_KEYS.CONNECTED)), 0);
  assert.equal(w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.DISCONNECTED).length, 1);
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('a failed reading is retried 15 s later, then counts as an outage', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const server = new FakeWgEasy();
  const w = await createWorld({ clock, server, timers: true });
  t.after(() => w.app.stop());
  server.online = false;
  clock.advance(30_000);
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(w.fake.sceneEvents.length, 0);
  clock.advance(15_000);
  t.mock.timers.tick(15_000);
  await settle();
  assert.deepEqual(
    w.fake.sceneEvents.map((e) => e.key),
    [TRIGGERS.UNREACHABLE],
  );
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = new FakeWgEasy();
  const w = await createWorld({ server, timers: true });
  await w.app.stop();
  const before = server.requests.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(server.requests.length, before);
});
