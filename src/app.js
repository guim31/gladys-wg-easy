// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring. (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { WgEasyHub } from './hub.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'wg-easy-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: request, timers, timings, now, dataDir
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new WgEasyHub({
    gladys,
    request: options.request,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
    dataDir: options.dataDir,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first reading is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The devices are published with should_poll: false (the hub reads the
  // server on its own timer); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady((device) => hub.pollDevice(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  const actions = {
    test_connection: () => hub.testConnection(),
    add_server: (fields) => hub.addServer(fields),
    remove_server: (fields) => hub.removeServer(fields),
    list_servers: () => hub.listServers(),
  };
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, whenReady(handler));
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
