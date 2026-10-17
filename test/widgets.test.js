// -----------------------------------------------------------------------------
// The `clients` dashboard widget: content within the core vocabulary and
// budget (validateWidgetContent), order of the rows, messages.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ago } from '../src/widgets.js';
import { BASE_CONFIG, FakeWgEasy, createClock, createWorld } from './helpers/world.js';

// Intl separates French numbers and units with non-breaking spaces.
const spaces = (text) => text.replace(/\s/g, ' ');

async function content(w, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
  assert.equal(ack.success, true, ack.error);
  const tree = ack.data.content;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

test('two tiles and one row per client, the connected ones first', async (t) => {
  const clock = createClock();
  const server = new FakeWgEasy();
  server.clients.push({
    ...server.clients[0],
    id: 3,
    name: 'Tablet',
    publicKey: Buffer.alloc(32, 3).toString('base64'),
    latestHandshakeAt: new Date(clock.now() - 2 * 3_600_000).toISOString(),
  });
  const w = await createWorld({ clock, server });
  t.after(() => w.app.stop());
  const tree = await content(w);
  const [connected, total, status] = tree.components;
  assert.equal(connected.value, 1);
  assert.equal(total.value, 3);
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Alice phone', 'Connected'],
      ['Tablet', '2 hr. ago'],
      ['Laptop', 'Disabled'],
    ],
  );
  const fr = await content(w, 'fr');
  assert.deepEqual(
    fr.components[2].items.map((item) => spaces(item.value)),
    ['Connecté', 'il y a 2 h', 'Désactivé'],
  );
});

test('more than ten clients: nine rows and a count of the others', async (t) => {
  const server = new FakeWgEasy();
  for (let i = 0; i < 12; i += 1) {
    server.clients.push({
      ...server.clients[1],
      id: 10 + i,
      name: `Client ${i}`,
      publicKey: Buffer.alloc(32, 10 + i).toString('base64'),
    });
  }
  const w = await createWorld({ server });
  t.after(() => w.app.stop());
  const { items } = (await content(w)).components[2];
  assert.equal(items.length, 10);
  assert.deepEqual([items.at(-1).label, items.at(-1).value], ['Other clients', 5]);
});

test('messages: no address, an error, no client', async (t) => {
  const none = await createWorld({ config: {} });
  t.after(() => none.app.stop());
  assert.match((await content(none)).components[0].text, /Enter the address/);

  const wrong = await createWorld({ config: { ...BASE_CONFIG, password: 'wrong' } });
  t.after(() => wrong.app.stop());
  assert.match((await content(wrong, 'de')).components[0].text, /Passwort abgelehnt/);

  const empty = await createWorld({ server: new FakeWgEasy({ clients: [] }) });
  t.after(() => empty.app.stop());
  assert.match((await content(empty)).components[0].text, /No client/);
});

test('the widget is refreshed when a client connects', async (t) => {
  const clock = createClock();
  const server = new FakeWgEasy();
  const w = await createWorld({ clock, server });
  t.after(() => w.app.stop());
  const before = w.fake.widgetRefreshes.length;
  await w.hub.poll();
  assert.equal(w.fake.widgetRefreshes.length, before, 'nothing changed');
  server.find('Laptop').enabled = true;
  server.handshake('Laptop', clock.now());
  await w.hub.poll();
  assert.equal(w.fake.widgetRefreshes.length, before + 1);
});

test('relative times', () => {
  const now = Date.UTC(2026, 9, 17, 12);
  assert.equal(ago(now - 30_000, now, 'en'), '1 min. ago');
  assert.equal(spaces(ago(now - 3 * 86_400_000, now, 'fr')), 'il y a 3 j');
});
