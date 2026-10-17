// -----------------------------------------------------------------------------
// The wg-easy hub: reads the servers on a timer of the container (the interval
// chosen in the configuration), publishes the devices and their states when
// they change, fires the scene events on transitions, and enables or disables
// clients on request. Each server is a WgEasyServer (src/server.js): the one
// of the configuration, and the ones added by the configuration actions
// (kept in /data, src/store.js).
//
// Gladys never polls these devices (should_poll: false): the scene events must
// fire even for a client whose device was not added, and a device created
// without should_poll is never polled by Gladys 5.2 (Gladys#3198).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { parseServerUrl } from './config.js';
import {
  FEATURE_KEYS,
  SERVER_ID,
  buildClientDevice,
  buildServerDevice,
  clientIds,
  clientKeyOf,
  clientValues,
  serverValues,
} from './devices.js';
import { WgEasyServer } from './server.js';
import { ServerStore } from './store.js';
import {
  COMMAND_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  SERVER_TEXT,
  errorText,
  pick,
  render,
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

// Servers added by the configuration action, on top of the configuration's.
export const MAX_EXTRA_SERVERS = 9;

export class WgEasyHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.request] HTTP seam (src/wgeasy/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, request, timers = true, timings, now, dataDir }) {
    this.gladys = gladys;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.store = new ServerStore(dataDir);
    this.config = null;
    /** The servers read, the configuration's first (id "1"). */
    this.servers = [];
    /** Last value published per feature external id. */
    this.published = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.heartbeatAt = 0;
    this.pollTimer = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
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

  // --- Servers ---------------------------------------------------------------

  /** The server of the configuration, null without a valid address. */
  get configServer() {
    return this.servers.find((server) => server.id === SERVER_ID) ?? null;
  }

  /** What the servers of a reading need: the configuration's, then the added ones. */
  wantedServers(config) {
    const wanted = [];
    if (config.url) {
      wanted.push({
        id: SERVER_ID,
        url: config.url,
        username: config.username,
        password: config.password,
        allowSelfSigned: config.allowSelfSigned,
      });
    }
    for (const entry of this.store.servers) {
      wanted.push(entry);
    }
    return wanted;
  }

  /**
   * Make the servers match the configuration and the store: a new address or
   * new credentials start that server over (no scene event for the clients its
   * first reading finds), the others keep their state.
   */
  async syncServers() {
    const wanted = this.wantedServers(this.config);
    const next = [];
    const dropped = [];
    for (const settings of wanted) {
      const current = this.servers.find((server) => server.id === settings.id);
      const fresh = new WgEasyServer(this, settings);
      if (current && current.signature === fresh.signature) {
        next.push(current);
      } else {
        if (current) {
          dropped.push(current);
        }
        next.push(fresh);
      }
    }
    for (const server of this.servers) {
      if (!next.includes(server) && !dropped.includes(server)) {
        dropped.push(server);
      }
    }
    this.servers = next;
    for (const server of dropped) {
      server.stop();
      await this.forget([...server.clients.values()], { silent: true });
      this.transports.delete(server.deviceId);
      for (const externalId of [...this.published.keys()]) {
        if (externalId.startsWith(`${server.deviceId}:`)) {
          this.published.delete(externalId);
        }
      }
    }
  }

  /** The server whose last reading holds this client key (else `asking`). */
  ownerOf(key, asking) {
    return this.servers.find((server) => server.clients.has(key)) ?? asking;
  }

  /** Every client of every server: [{ server, entry }]. */
  entries() {
    return this.servers.flatMap((server) =>
      [...server.clients.values()].map((entry) => ({ server, entry })),
    );
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.store.load();
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
    if (previous && previous.language !== config.language) {
      // The last handshake is a localized text.
      this.published.clear();
    }
    await this.syncServers();
    this.discovered = null;
    try {
      await this.poll();
    } finally {
      // Even after an unexpected error: the timer keeps reading.
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await Promise.all(this.servers.map((server) => server.stop()));
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.servers.length === 0) {
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

  // --- Reading the servers ---------------------------------------------------

  /** Read every server, one after the other (their events stay in order). */
  async poll() {
    if (this.servers.length === 0) {
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    for (const server of [...this.servers]) {
      await server.poll();
    }
  }

  /** Gladys asks for a refresh (onPoll): read now. */
  async pollDevice() {
    await this.poll();
  }

  refreshWidget() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /**
   * Clients gone (deleted in wg-easy, or their server removed): their devices
   * may remain in Gladys, shown disconnected; their last values are
   * forgotten, should they come back.
   */
  async forget(entries, { silent = false } = {}) {
    const states = [];
    for (const { client, connected } of entries) {
      const ids = clientIds(this.gladys, client.key);
      for (const externalId of [...this.published.keys()]) {
        if (externalId.startsWith(`${ids.device}:`)) {
          this.published.delete(externalId);
        }
      }
      this.transports.delete(ids.device);
      if (connected && !silent) {
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
    const options = { language: this.config.language, allowControl: this.config.allowControl };
    return this.servers.flatMap((server) => [
      buildServerDevice(this.gladys, {
        url: server.url,
        language: this.config.language,
        id: server.id,
      }),
      ...[...server.clients.values()].map(({ client }) =>
        buildClientDevice(this.gladys, client, options),
      ),
    ]);
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

  /** Every feature value of the last readings. */
  values() {
    const now = this.now();
    return this.servers
      .filter((server) => server.read)
      .flatMap((server) => {
        const clients = [...server.clients.values()].map((entry) => entry.client);
        return [
          ...serverValues(this.gladys, clients, { now, id: server.id }),
          ...clients.flatMap((client) =>
            clientValues(this.gladys, client, { now, language: this.config.language }),
          ),
        ];
      });
  }

  async publishStates({ force = false, only = null } = {}) {
    if (!this.servers.some((server) => server.read)) {
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

  /** The transport badge of a server and of its clients. */
  async publishTransports(server, reachable) {
    const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    const ids = [
      server.deviceId,
      ...[...server.clients.keys()].map((key) => clientIds(this.gladys, key).device),
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

  /**
   * The status under the integration name: connected when every server
   * answers; else the error of the first failing one, named when there are
   * several servers.
   */
  connectionStatus() {
    if (this.servers.length === 0) {
      return {
        connected: false,
        message: this.config.invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    const failing = this.servers.find((server) => server.error);
    if (!failing) {
      return { connected: true };
    }
    const text = ERROR_TEXT[failing.error.kind] ?? ERROR_TEXT.http;
    if (this.servers.length === 1) {
      return { connected: false, message: text };
    }
    return {
      connected: false,
      message: Object.fromEntries(
        Object.keys(text).map((language) => [language, `${failing.name}: ${text[language]}`]),
      ),
    };
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

  /** The server of a device external id (server or client device), null when none. */
  serverOfDevice(externalId) {
    const key = clientKeyOf(this.gladys, externalId);
    return (
      this.servers.find(
        (server) => server.deviceId === externalId || (key !== null && server.clients.has(key)),
      ) ?? null
    );
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const isServer = this.servers.some((server) => server.deviceId === device.external_id);
    if (!isServer && !clientKeyOf(this.gladys, device.external_id)) {
      return;
    }
    await this.publishStates({ force: true, only: device.external_id });
    // Sent before the device existed, the transport was dropped by Gladys.
    this.transports.delete(device.external_id);
    const server = this.serverOfDevice(device.external_id);
    if (server && (server.read || server.error)) {
      await this.publishTransports(server, server.error === null);
    }
    this.refreshWidget();
  }

  /** "Search" in the Discovery tab: publish the devices again, read the servers. */
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
    const server = this.servers.find((candidate) => candidate.clients.has(key));
    const entry = server?.clients.get(key);
    if (!entry) {
      throw new Error(pick(COMMAND_TEXT.unknownClient, language));
    }
    const enabled = Number(value) === 1;
    try {
      await server.client.setEnabled(entry.client.id, enabled);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`Client ${entry.client.name}: command failed: ${err.message}`);
      throw new Error(errorText(err, language), { cause: err });
    }
    logger.info(`Client ${entry.client.name} ${enabled ? 'enabled' : 'disabled'}`);
    // Read back: the switch shows what wg-easy really did.
    await server.poll();
  }

  // --- Configuration actions -------------------------------------------------

  /** One line per server: its answer, or its error. */
  report() {
    if (this.servers.length === 0) {
      const status = this.connectionStatus();
      return status.message;
    }
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      message[language] = this.servers
        .map((server) => {
          const line = server.error
            ? pick(ERROR_TEXT[server.error.kind] ?? ERROR_TEXT.http, language)
            : server.read
              ? text.ok(
                  server.client.version,
                  server.clients.size,
                  [...server.clients.values()].filter((entry) => entry.connected).length,
                )
              : pick(SERVER_TEXT.waiting, language);
          return this.servers.length > 1 ? `${server.name}: ${line}` : line;
        })
        .join('\n');
    }
    return message;
  }

  /** "Test the connection": read the servers now, one line each. */
  async testConnection() {
    await this.poll();
    return this.report();
  }

  /** "Add a wg-easy server": another server, kept in /data. */
  async addServer(fields = {}) {
    const typed = typeof fields.url === 'string' ? fields.url.trim() : '';
    const url = parseServerUrl(typed);
    if (!url) {
      return CONNECTION_TEXT.invalidUrl;
    }
    const known = this.servers.find((server) => server.url === url);
    const settings = {
      url,
      username:
        typeof fields.username === 'string' && fields.username.trim()
          ? fields.username.trim()
          : 'admin',
      password: typeof fields.password === 'string' ? fields.password : '',
      allowSelfSigned: fields.allow_self_signed === true || fields.allow_self_signed === 'true',
    };
    if (known?.id === SERVER_ID) {
      return render(SERVER_TEXT.inConfig, { name: known.name });
    }
    if (!known && this.store.servers.length >= MAX_EXTRA_SERVERS) {
      return render(SERVER_TEXT.tooMany, { max: MAX_EXTRA_SERVERS });
    }
    const entry = known
      ? { ...this.store.servers.find((saved) => saved.id === known.id), ...settings }
      : { id: this.store.nextId(), ...settings };
    await this.store.put(entry);
    logger.info(`Configuration action: wg-easy server ${known ? 'updated' : 'added'}: ${url}`);
    await this.syncServers();
    this.discovered = null;
    const server = this.servers.find((candidate) => candidate.id === entry.id);
    await server.poll();
    this.schedulePoll();
    const outcome = server.error
      ? (ERROR_TEXT[server.error.kind] ?? ERROR_TEXT.http)
      : render(SERVER_TEXT.read, { clients: server.clients.size });
    return Object.fromEntries(
      Object.keys(REPORT_TEXT).map((language) => [
        language,
        [
          pick(
            render(known ? SERVER_TEXT.updated : SERVER_TEXT.added, { name: server.name }),
            language,
          ),
          pick(outcome, language),
        ].join('\n'),
      ]),
    );
  }

  /** "Remove a wg-easy server": an added server, by its address or its name. */
  async removeServer(fields = {}) {
    const typed = typeof fields.server === 'string' ? fields.server.trim() : '';
    const url = parseServerUrl(typed);
    const server = this.servers.find(
      (candidate) =>
        candidate.deviceId === typed ||
        candidate.url === url ||
        candidate.name.toLowerCase() === typed.toLowerCase(),
    );
    if (!server) {
      return render(SERVER_TEXT.unknown, {
        query: typed,
        servers: this.servers.map((candidate) => candidate.name).join(', ') || '-',
      });
    }
    if (server.id === SERVER_ID) {
      return render(SERVER_TEXT.removeConfig, { name: server.name });
    }
    await this.store.remove(server.id);
    logger.info(`Configuration action: wg-easy server removed: ${server.url}`);
    await this.syncServers();
    await this.publishDevices();
    await this.publishConnectionStatus();
    this.refreshWidget();
    return render(SERVER_TEXT.removed, { name: server.name });
  }

  /** "Show the servers": each one with its state. */
  listServers() {
    return this.report();
  }
}
