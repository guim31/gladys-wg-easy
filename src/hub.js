// -----------------------------------------------------------------------------
// The wg-easy hub: reads the server on a timer of the container (the interval
// chosen in the configuration), publishes the devices and their states when
// they change, fires the scene events on transitions, and enables or disables
// clients on request.
//
// Gladys never polls these devices (should_poll: false): the scene events must
// fire even for a client whose device was not added, and a device created
// without should_poll is never polled by Gladys 5.2 (Gladys#3198).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  buildClientDevice,
  buildServerDevice,
  clientIds,
  clientKeyOf,
  clientValues,
  isConnected,
  serverIds,
  serverValues,
} from './devices.js';
import { ERROR_KINDS, WgEasyClient } from './wgeasy/client.js';
import {
  COMMAND_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  errorText,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'wg-easy-hub' });

export const WIDGET_KEY = 'clients';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  CONNECTED: 'client_connected',
  DISCONNECTED: 'client_disconnected',
  UNREACHABLE: 'server_unreachable',
  RECOVERED: 'server_recovered',
});

export const HUB_TIMINGS = {
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the server counts as down (scene event).
  downAfterFailures: 2,
  // Every state is sent again at least this often, so that Gladys never shows
  // "no recent value" for a value that does not change.
  heartbeatMs: 12 * 60 * 60_000,
};

const MAX_STATES_PER_REQUEST = 100;

const signature = (config) =>
  JSON.stringify([config.url, config.username, config.password, config.allowSelfSigned]);

export class WgEasyHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.request] HTTP seam (src/wgeasy/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    this.resetServer();
    /** Last value published per feature external id. */
    this.published = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.heartbeatAt = 0;
    this.pollTimer = null;
    this.retryTimer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  resetServer() {
    /** Clients of the last successful reading, by key, with what the hub knows of them. */
    this.clients = new Map();
    this.read = false; // at least one successful reading
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.downSince = null;
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (server connected, lost, back, user
  // commands). A problem that repeats every cycle is logged once at its own
  // level, then at debug until it clears. LOG_LEVEL=debug shows everything.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key) {
    this.warned.delete(key);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (signature(config) !== this.signature) {
      // Another server or other credentials: start over, without scene
      // events for the clients the first reading finds.
      this.signature = signature(config);
      this.client = config.url
        ? new WgEasyClient({
            url: config.url,
            username: config.username,
            password: config.password,
            insecure: config.allowSelfSigned,
            request: this.request,
          })
        : null;
      clearTimeout(this.retryTimer);
      this.resetServer();
      this.published.clear();
    } else if (previous && previous.language !== config.language) {
      // The last handshake is a localized text.
      this.published.clear();
    }
    this.discovered = null;
    try {
      // Fresh: a reading in flight may be of the previous server, or may
      // have published before `published` was cleared.
      await this.poll({ fresh: true });
    } finally {
      // Even after an unexpected error: the timer keeps reading.
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.polling;
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Poll failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.poll()
        .then(() => this.resolved('retry'))
        .catch((err) => this.problem('retry', 'Retry failed', err, 'error'));
    }, this.timings.retryMs);
    this.retryTimer.unref?.();
  }

  // --- Reading the server ----------------------------------------------------

  /** Read the server and apply what changed. Concurrent calls share the read. */
  poll({ fresh = false } = {}) {
    if (this.polling && !fresh && this.pollingFor === this.client) {
      return this.polling;
    }
    // Chained after the reading in flight, never alongside it.
    const previous = this.polling ?? Promise.resolve();
    this.pollingFor = this.client;
    const current = previous
      .catch(() => {})
      .then(() => this.readServer())
      .finally(() => {
        if (this.polling === current) {
          this.polling = null;
        }
      });
    this.polling = current;
    return current;
  }

  /** Gladys asks for a refresh (onPoll): read now. */
  async pollDevice() {
    await this.poll();
  }

  async readServer() {
    if (!this.client) {
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    const client = this.client;
    let list;
    try {
      list = await client.listClients();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      if (client === this.client) {
        await this.applyFailure(err);
      }
      return;
    }
    // The configuration changed during the reading: this one is stale.
    if (client === this.client) {
      await this.applySuccess(list);
    }
  }

  async applySuccess(list) {
    const now = this.now();
    let widgetChanged = this.error !== null || !this.read;
    if (this.down) {
      const downMinutes = Math.round((now - this.downSince) / 60_000);
      logger.info(`wg-easy answers again after ${downMinutes} min`);
      await this.fire(TRIGGERS.RECOVERED, { down_minutes: downMinutes });
    } else if (this.error) {
      logger.info('wg-easy: connection restored');
    } else if (!this.read) {
      logger.info(`wg-easy v${this.client.version}: connected, ${list.length} client(s)`);
    }
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.downSince = null;
    clearTimeout(this.retryTimer);

    const next = new Map();
    for (const client of list) {
      const before = this.clients.get(client.key);
      // wg-easy forgets the handshake of a disabled client, and of a client
      // enabled again (seen on 15.4): show the last one known, not "Never".
      // Only `handshakeAt` decides whether it is connected.
      client.seenAt = client.handshakeAt ?? before?.client.seenAt ?? null;
      const connected = isConnected(client, now);
      const entry = {
        client,
        connected,
        connectedSince: connected ? (before?.connected ? before.connectedSince : now) : null,
      };
      next.set(client.key, entry);
      widgetChanged ||=
        !before ||
        before.connected !== connected ||
        before.client.enabled !== client.enabled ||
        before.client.name !== client.name;
      // No event at the first reading: what was the state before?
      if (this.read && (before?.connected ?? false) !== connected) {
        await this.fireClient(entry, before, now);
      }
    }
    const removed = [];
    for (const [key, before] of this.clients) {
      if (!next.has(key)) {
        widgetChanged = true;
        removed.push(before);
        logger.debug(`Client ${before.client.name} removed from wg-easy`);
        if (before.connected) {
          await this.fireClient({ client: before.client, connected: false }, before, now);
        }
      }
    }
    this.clients = next;
    await this.forget(removed);
    this.read = true;

    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports(true);
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /**
   * Clients deleted in wg-easy: their devices may remain in Gladys, shown
   * disconnected; their last values are forgotten, should they come back.
   */
  async forget(entries) {
    const states = [];
    for (const { client, connected } of entries) {
      const ids = clientIds(this.gladys, client.key);
      for (const externalId of [...this.published.keys()]) {
        if (externalId.startsWith(`${ids.device}:`)) {
          this.published.delete(externalId);
        }
      }
      this.transports.delete(ids.device);
      if (connected) {
        states.push({ device_feature_external_id: ids.feature(FEATURE_KEYS.CONNECTED), state: 0 });
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishStates(states);
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async fireClient(entry, before, now) {
    const { client, connected } = entry;
    const device = clientIds(this.gladys, client.key).device;
    if (connected) {
      logger.debug(`Client ${client.name} connected`);
      await this.fire(TRIGGERS.CONNECTED, { device, client: client.name });
      return;
    }
    const since = before?.connectedSince;
    logger.debug(`Client ${client.name} disconnected`);
    await this.fire(TRIGGERS.DISCONNECTED, {
      device,
      client: client.name,
      connected_minutes: since ? Math.max(0, Math.round((now - since) / 60_000)) : 0,
    });
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`wg-easy: ${err.message}`);
    } else {
      logger.debug(`wg-easy: ${err.message} (again)`);
    }
    // Only silence counts as down: a refused password is a configuration
    // problem, reported by the connection status.
    if (err.kind === ERROR_KINDS.UNREACHABLE) {
      this.failures += 1;
      if (this.failures === 1) {
        this.downSince = this.now();
        this.scheduleRetry();
      }
      // Never before a first successful reading: at a reboot of the host,
      // wg-easy may simply not be started yet.
      if (this.read && !this.down && this.failures >= this.timings.downAfterFailures) {
        this.down = true;
        await this.fire(TRIGGERS.UNREACHABLE, {
          error: pick(ERROR_TEXT[err.kind], this.config.language),
        });
      }
    } else {
      // It answers, if only to refuse: the outage is over.
      if (this.down) {
        await this.fire(TRIGGERS.RECOVERED, {
          down_minutes: Math.round((this.now() - this.downSince) / 60_000),
        });
      }
      this.failures = 0;
      this.down = false;
      this.downSince = null;
    }
    await this.publishDevices();
    await this.publishTransports(false);
    await this.publishConnectionStatus();
    if (wasError !== err.kind) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  devices() {
    if (!this.config.url) {
      return [];
    }
    const options = { language: this.config.language, allowControl: this.config.allowControl };
    return [
      buildServerDevice(this.gladys, { url: this.config.url, language: this.config.language }),
      ...[...this.clients.values()].map(({ client }) =>
        buildClientDevice(this.gladys, client, options),
      ),
    ];
  }

  /** Publish the discovered devices when the list changes (names, clients, options). */
  async publishDevices({ force = false } = {}) {
    const devices = this.devices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** Every feature value of the last reading. */
  values() {
    const now = this.now();
    const clients = [...this.clients.values()].map((entry) => entry.client);
    return [
      ...serverValues(this.gladys, clients, { now }),
      ...clients.flatMap((client) =>
        clientValues(this.gladys, client, { now, language: this.config.language }),
      ),
    ];
  }

  async publishStates({ force = false, only = null } = {}) {
    if (!this.read) {
      return;
    }
    const now = this.now();
    const heartbeat = now - this.heartbeatAt >= this.timings.heartbeatMs;
    const states = [];
    for (const { externalId, value } of this.values()) {
      if (value === null || (only && !externalId.startsWith(`${only}:`))) {
        continue;
      }
      if (!force && !heartbeat && this.published.get(externalId) === value) {
        continue;
      }
      // A text/text feature takes `text`, every other one a numeric `state`.
      states.push(
        typeof value === 'string'
          ? { device_feature_external_id: externalId, text: value }
          : { device_feature_external_id: externalId, state: value },
      );
    }
    let failed = false;
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(batch);
        for (const state of batch) {
          this.published.set(state.device_feature_external_id, state.state ?? state.text);
        }
        this.resolved('states');
      } catch (err) {
        failed = true;
        this.problem('states', `States refused: ${err.message}`);
      }
    }
    if (heartbeat && !only && !failed) {
      this.heartbeatAt = now;
    }
  }

  async publishTransports(reachable) {
    const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    const ids = [
      serverIds(this.gladys).device,
      ...[...this.clients.keys()].map((key) => clientIds(this.gladys, key).device),
    ];
    for (const externalId of ids) {
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    // The SDK takes 100 entries per call.
    for (let at = 0; at < entries.length; at += 100) {
      const batch = entries.slice(at, at + 100);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.resolved('transports');
      } catch (err) {
        this.problem('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] ?? ERROR_TEXT.http };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (
      device.external_id === serverIds(this.gladys).device ||
      clientKeyOf(this.gladys, device.external_id)
    ) {
      await this.publishStates({ force: true, only: device.external_id });
      // Sent before the device existed, the transport was dropped by Gladys.
      this.transports.delete(device.external_id);
      if (this.read || this.error) {
        await this.publishTransports(this.error === null);
      }
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** "Search" in the Discovery tab: publish the devices again, read the server. */
  async rediscover() {
    this.discovered = null;
    await this.poll();
  }

  // --- Commands --------------------------------------------------------------

  /** The "Access enabled" switch of a client device. */
  async setValue(device, feature, value) {
    const key = clientKeyOf(this.gladys, device.external_id);
    if (!key || feature.external_id !== clientIds(this.gladys, key).feature(FEATURE_KEYS.ENABLED)) {
      throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
    const language = this.config.language;
    if (!this.config.allowControl) {
      throw new Error(pick(COMMAND_TEXT.readOnly, language));
    }
    const entry = this.clients.get(key);
    if (!entry) {
      throw new Error(pick(COMMAND_TEXT.unknownClient, language));
    }
    const enabled = Number(value) === 1;
    try {
      await this.client.setEnabled(entry.client.id, enabled);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`Client ${entry.client.name}: command failed: ${err.message}`);
      throw new Error(errorText(err, language), { cause: err });
    }
    logger.info(`Client ${entry.client.name} ${enabled ? 'enabled' : 'disabled'}`);
    // Read back: the switch shows what wg-easy really did.
    await this.poll();
  }

  // --- Reports ---------------------------------------------------------------

  /** "Test the connection": read the server now, one line. */
  async testConnection() {
    await this.poll();
    const status = this.connectionStatus();
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const clients = [...this.clients.values()];
      message[language] = text.ok(
        this.client.version,
        clients.length,
        clients.filter((entry) => entry.connected).length,
      );
    }
    return message;
  }
}
