// -----------------------------------------------------------------------------
// One wg-easy server read by the hub: its API client, the clients of its last
// reading, its outage state and its retry timer. Several servers can be
// watched (forum t/11334): the one of the configuration (id "1", the id of
// the only server of 1.0.0, so its devices keep their external ids) and the
// ones added by the "Add a wg-easy server" action (ids "2", "3"…).
//
// The hub owns what is shared: the publishing to Gladys (devices, states,
// transports, connection status), the scene events and the logs' memory.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { clientIds, isConnected, serverIds, serverName } from './devices.js';
import { ERROR_KINDS, WgEasyClient } from './wgeasy/client.js';
import { ERROR_TEXT, pick } from './texts.js';

const logger = createLogger({ name: 'wg-easy-hub' });

export class WgEasyServer {
  /**
   * @param {object} hub the WgEasyHub
   * @param {{ id: string, url: string, username: string, password: string, allowSelfSigned: boolean }} settings
   */
  constructor(hub, settings) {
    this.hub = hub;
    this.id = settings.id;
    this.url = settings.url;
    this.name = serverName(settings.url);
    this.signature = JSON.stringify([
      settings.url,
      settings.username,
      settings.password,
      settings.allowSelfSigned,
    ]);
    this.client = new WgEasyClient({
      url: settings.url,
      username: settings.username,
      password: settings.password,
      insecure: settings.allowSelfSigned,
      request: hub.request,
    });
    /** Clients of the last successful reading, by key, with what the hub knows of them. */
    this.clients = new Map();
    this.read = false; // at least one successful reading
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.downSince = null;
    this.retryTimer = null;
    this.polling = null;
    this.stopped = false;
  }

  get deviceId() {
    return serverIds(this.hub.gladys, this.id).device;
  }

  /** "wg-easy 192.0.2.10:51821: …", the prefix of its log lines. */
  log(level, message) {
    logger[level](`${this.name}: ${message}`);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    return this.polling;
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.hub.timersEnabled || this.stopped || this.hub.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.poll()
        .then(() => this.hub.resolved(`retry-${this.id}`))
        .catch((err) => this.hub.problem(`retry-${this.id}`, 'Retry failed', err, 'error'));
    }, this.hub.timings.retryMs);
    this.retryTimer.unref?.();
  }

  /** Read the server and apply what changed. Concurrent calls share the read. */
  poll() {
    if (this.polling) {
      return this.polling;
    }
    const current = this.readServer().finally(() => {
      if (this.polling === current) {
        this.polling = null;
      }
    });
    this.polling = current;
    return current;
  }

  async readServer() {
    let list;
    try {
      list = await this.client.listClients();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      if (!this.stopped) {
        await this.applyFailure(err);
      }
      return;
    }
    // Removed or reconfigured during the reading: this one is stale.
    if (!this.stopped) {
      await this.applySuccess(list);
    }
  }

  async applySuccess(list) {
    const { hub } = this;
    const now = hub.now();
    let widgetChanged = this.error !== null || !this.read;
    if (this.down) {
      const downMinutes = Math.round((now - this.downSince) / 60_000);
      this.log('info', `answers again after ${downMinutes} min`);
      await hub.fire('server_recovered', this.eventData({ down_minutes: downMinutes }));
    } else if (this.error) {
      this.log('info', 'connection restored');
    } else if (!this.read) {
      this.log('info', `v${this.client.version}, connected, ${list.length} client(s)`);
    }
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.downSince = null;
    clearTimeout(this.retryTimer);

    const next = new Map();
    for (const client of list) {
      // The same key on two servers (a configuration copied): the first
      // server keeps it, the device ids being those of the key.
      if (hub.ownerOf(client.key, this) !== this) {
        hub.problem(
          `duplicate-${client.key}`,
          `${this.name}: client ${client.name} is already watched on another server, skipped`,
        );
        continue;
      }
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
        logger.debug(`Client ${before.client.name} removed from ${this.name}`);
        if (before.connected) {
          await this.fireClient({ client: before.client, connected: false }, before, now);
        }
      }
    }
    this.clients = next;
    await hub.forget(removed);
    this.read = true;

    await hub.publishDevices();
    await hub.publishStates();
    await hub.publishTransports(this, true);
    await hub.publishConnectionStatus();
    if (widgetChanged) {
      hub.refreshWidget();
    }
  }

  /** The data of a scene event of this server: its name and its device. */
  eventData(data = {}) {
    return { ...data, server: this.name, server_device: this.deviceId };
  }

  async fireClient(entry, before, now) {
    const { client, connected } = entry;
    const device = clientIds(this.hub.gladys, client.key).device;
    if (connected) {
      logger.debug(`Client ${client.name} connected`);
      await this.hub.fire('client_connected', this.eventData({ device, client: client.name }));
      return;
    }
    const since = before?.connectedSince;
    logger.debug(`Client ${client.name} disconnected`);
    await this.hub.fire(
      'client_disconnected',
      this.eventData({
        device,
        client: client.name,
        connected_minutes: since ? Math.max(0, Math.round((now - since) / 60_000)) : 0,
      }),
    );
  }

  async applyFailure(err) {
    const { hub } = this;
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      this.log('warn', err.message);
    } else {
      logger.debug(`${this.name}: ${err.message} (again)`);
    }
    // Only silence counts as down: a refused password is a configuration
    // problem, reported by the connection status.
    if (err.kind === ERROR_KINDS.UNREACHABLE) {
      this.failures += 1;
      if (this.failures === 1) {
        this.downSince = hub.now();
        this.scheduleRetry();
      }
      // Never before a first successful reading: at a reboot of the host,
      // wg-easy may simply not be started yet.
      if (this.read && !this.down && this.failures >= hub.timings.downAfterFailures) {
        this.down = true;
        await hub.fire(
          'server_unreachable',
          this.eventData({ error: pick(ERROR_TEXT[err.kind], hub.config.language) }),
        );
      }
    } else {
      // It answers, if only to refuse: the outage is over.
      if (this.down) {
        await hub.fire(
          'server_recovered',
          this.eventData({ down_minutes: Math.round((hub.now() - this.downSince) / 60_000) }),
        );
      }
      this.failures = 0;
      this.down = false;
      this.downSince = null;
    }
    await hub.publishDevices();
    await hub.publishTransports(this, false);
    await hub.publishConnectionStatus();
    if (wasError !== err.kind) {
      hub.refreshWidget();
    }
  }
}
