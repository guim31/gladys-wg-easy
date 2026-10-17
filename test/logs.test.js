// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a password. (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CONFIG, FakeWgEasy, createClock, createWorld } from './helpers/world.js';

/** Capture the lines of the SDK logger at `level`. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

test('a normal reading cycle writes nothing at info, connections included', async (t) => {
  const logs = captureLogs(t);
  const clock = createClock();
  const server = new FakeWgEasy();
  const w = await createWorld({ clock, server });
  t.after(() => w.app.stop());
  assert.ok(logs.texts().some((text) => text.includes('connected, 2 client(s)')));
  logs.clear();
  server.find('Laptop').enabled = true;
  for (let i = 0; i < 10; i += 1) {
    clock.advance(60_000);
    server.handshake('Laptop', clock.now());
    await w.hub.poll();
  }
  assert.deepEqual(logs.texts(), []);
});

test('an outage is logged once when it starts and once when it ends', async (t) => {
  const logs = captureLogs(t);
  const clock = createClock();
  const server = new FakeWgEasy();
  const w = await createWorld({ clock, server });
  t.after(() => w.app.stop());
  logs.clear();
  server.online = false;
  for (let i = 0; i < 5; i += 1) {
    clock.advance(30_000);
    await w.hub.poll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  server.online = true;
  await w.hub.poll();
  assert.equal(logs.lines.length, 2);
  assert.match(logs.texts()[1], /answers again/);
});

test('the password is never written, even in debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const server = new FakeWgEasy({ password: 'top-secret-pw' });
  const w = await createWorld({
    server,
    config: { ...BASE_CONFIG, password: 'wrong-secret-pw', allow_control: true },
  });
  t.after(() => w.app.stop());
  await w.hub.poll();
  await w.fake.action('test_connection', {});
  const all = logs.texts().join('\n');
  assert.ok(logs.lines.length > 0);
  assert.ok(!all.includes('secret-pw'), 'no password in the logs');
  assert.ok(!all.includes(Buffer.from('admin:wrong-secret-pw').toString('base64')));
});
