// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake wg-easy on a fake
// network and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs unless `timers: true` (with node:test mock
// timers): the tests read the server with `world.hub.poll()`.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { CLIENT_TYPE, SERVER_ID, SERVER_TYPE } from '../../src/devices.js';
import { keyId } from '../../src/wgeasy/client.js';
import { FakeWgEasy, FIXTURES, createNetwork } from './fakeWgEasy.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';
// Dates of the last handshake are formatted in the time zone of Gladys.
process.env.TZ = 'Europe/Paris';

export const URL_1 = 'http://192.0.2.10:51821';

// The handshake of the v15 fixture (13:11:22 UTC): the clock starts 30 s later.
export const HANDSHAKE = Date.parse(FIXTURES.v15[0].latestHandshakeAt);

/** A manual clock. */
export function createClock(start = HANDSHAKE + 30_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const BASE_CONFIG = {
  url: URL_1,
  username: 'admin',
  password: 'secret',
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {FakeWgEasy} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  server = new FakeWgEasy(),
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork({ [URL_1]: server });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, server, network, app, hub: app.hub, clock };
}

export const serverDeviceId = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID).device;
export const serverFeatureId = (gladys, feature) =>
  gladys.externalIds(SERVER_TYPE, SERVER_ID).feature(feature);

/** Device / feature external ids of the client named `name` on `server`. */
export function clientIdsOf(gladys, server, name) {
  return gladys.externalIds(CLIENT_TYPE, keyId(server.find(name).publicKey));
}

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeWgEasy, FIXTURES };
