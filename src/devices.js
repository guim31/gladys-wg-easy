// -----------------------------------------------------------------------------
// Gladys devices: one for the wg-easy server, one per WireGuard client.
//
// Identity: the server is the one of the configuration (`server:1`); a client
// is its WireGuard public key, in hexadecimal. Not the wg-easy id: a migration
// from v14 to v15 renumbers the clients (uuid to integer) but keeps the keys.
//
// Client features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - connected: presence-sensor/binary, 1 when the last handshake is less
//     than 3 minutes old (WireGuard renews it every 2 minutes while packets
//     flow) and the client is enabled;
//   - access enabled: switch/binary, read only unless the configuration
//     allows controlling the clients from Gladys;
//   - received by / sent by the client: data/size in megabytes, the counters
//     of the WireGuard interface (reset when it restarts);
//   - last handshake: text/text, the local date and time (Gladys has no
//     timestamp couple; a text changes only when the handshake does, where a
//     "minutes ago" duration would change at every reading).
// Server features: connected clients, clients (counter-sensor/integer).
//
// The devices are published with should_poll: false: the integration reads
// the server on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';

export const SERVER_TYPE = 'server';
export const SERVER_ID = '1';
export const CLIENT_TYPE = 'client';
export const URL_PARAM = 'WG_EASY_URL';
export const ADDRESS_PARAM = 'WG_ADDRESS';

// A handshake younger than this means connected: WireGuard renews the
// session every 2 minutes while packets flow (REKEY_AFTER_TIME, 120 s).
export const CONNECTED_WITHIN_MS = 3 * 60_000;

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  CONNECTED: 'connected',
  ENABLED: 'enabled',
  RECEIVED: 'received_mb',
  SENT: 'sent_mb',
  HANDSHAKE: 'last_handshake',
  CONNECTED_CLIENTS: 'connected_clients',
  CLIENTS: 'clients',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.CONNECTED]: 'Connected',
    [FEATURE_KEYS.ENABLED]: 'Access enabled',
    [FEATURE_KEYS.RECEIVED]: 'Received by the client',
    [FEATURE_KEYS.SENT]: 'Sent by the client',
    [FEATURE_KEYS.HANDSHAKE]: 'Last handshake',
    [FEATURE_KEYS.CONNECTED_CLIENTS]: 'Connected clients',
    [FEATURE_KEYS.CLIENTS]: 'Clients',
  },
  fr: {
    [FEATURE_KEYS.CONNECTED]: 'Connecté',
    [FEATURE_KEYS.ENABLED]: 'Accès autorisé',
    [FEATURE_KEYS.RECEIVED]: 'Reçu par le client',
    [FEATURE_KEYS.SENT]: 'Envoyé par le client',
    [FEATURE_KEYS.HANDSHAKE]: 'Dernier handshake',
    [FEATURE_KEYS.CONNECTED_CLIENTS]: 'Clients connectés',
    [FEATURE_KEYS.CLIENTS]: 'Clients',
  },
  de: {
    [FEATURE_KEYS.CONNECTED]: 'Verbunden',
    [FEATURE_KEYS.ENABLED]: 'Zugang aktiviert',
    [FEATURE_KEYS.RECEIVED]: 'Vom Client empfangen',
    [FEATURE_KEYS.SENT]: 'Vom Client gesendet',
    [FEATURE_KEYS.HANDSHAKE]: 'Letzter Handshake',
    [FEATURE_KEYS.CONNECTED_CLIENTS]: 'Verbundene Clients',
    [FEATURE_KEYS.CLIENTS]: 'Clients',
  },
  es: {
    [FEATURE_KEYS.CONNECTED]: 'Conectado',
    [FEATURE_KEYS.ENABLED]: 'Acceso habilitado',
    [FEATURE_KEYS.RECEIVED]: 'Recibido por el cliente',
    [FEATURE_KEYS.SENT]: 'Enviado por el cliente',
    [FEATURE_KEYS.HANDSHAKE]: 'Último handshake',
    [FEATURE_KEYS.CONNECTED_CLIENTS]: 'Clientes conectados',
    [FEATURE_KEYS.CLIENTS]: 'Clientes',
  },
};

// Display bounds (the core never applies them on write).
const MAX_MEGABYTES = 100_000_000; // 100 TB
const MAX_CLIENTS = 65_535;

const sensor = (category, type, extra = {}) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const megabytes = (bytes) => (bytes === null ? null : Math.round(bytes / 100_000) / 10);

/** Whether a client is connected at `now` (enabled, recent handshake). */
export function isConnected(client, now) {
  return (
    client.enabled && client.handshakeAt !== null && now - client.handshakeAt < CONNECTED_WITHIN_MS
  );
}

/**
 * The local date and time of a handshake, in the configured language (TZ of
 * Gladys). Null when none is known: wg-easy forgets the handshake of a client
 * disabled or enabled again, so "never" cannot be told from "not known".
 */
export function formatHandshake(time, language) {
  if (time === null || time === undefined) {
    return null;
  }
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(time),
  );
}

// Order = display order in Gladys.
const CLIENT_FEATURES = [
  {
    key: FEATURE_KEYS.CONNECTED,
    definition: () =>
      sensor(DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.BINARY),
    value: ({ client, now }) => (isConnected(client, now) ? 1 : 0),
  },
  {
    key: FEATURE_KEYS.ENABLED,
    definition: ({ allowControl }) => ({
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: !allowControl,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    }),
    value: ({ client }) => (client.enabled ? 1 : 0),
  },
  {
    key: FEATURE_KEYS.RECEIVED,
    definition: () =>
      sensor(DEVICE_FEATURE_CATEGORIES.DATA, DEVICE_FEATURE_TYPES.DATA.SIZE, {
        unit: DEVICE_FEATURE_UNITS.MEGABYTE,
        max: MAX_MEGABYTES,
      }),
    // Received by the client = sent by the server (tx).
    value: ({ client }) => megabytes(client.tx),
  },
  {
    key: FEATURE_KEYS.SENT,
    definition: () =>
      sensor(DEVICE_FEATURE_CATEGORIES.DATA, DEVICE_FEATURE_TYPES.DATA.SIZE, {
        unit: DEVICE_FEATURE_UNITS.MEGABYTE,
        max: MAX_MEGABYTES,
      }),
    value: ({ client }) => megabytes(client.rx),
  },
  {
    key: FEATURE_KEYS.HANDSHAKE,
    definition: () =>
      sensor(DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
        keep_history: false,
        max: 0,
      }),
    // `seenAt`: the last handshake known to the hub (src/hub.js).
    value: ({ client, language }) => formatHandshake(client.seenAt ?? client.handshakeAt, language),
  },
];

const SERVER_FEATURES = [
  {
    key: FEATURE_KEYS.CONNECTED_CLIENTS,
    value: ({ clients, now }) => clients.filter((client) => isConnected(client, now)).length,
  },
  { key: FEATURE_KEYS.CLIENTS, value: ({ clients }) => clients.length },
];

const counter = () =>
  sensor(DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, {
    max: MAX_CLIENTS,
  });

// The server of the configuration is "1" (the only one of 1.0.0), the added ones "2", "3"…
export const serverIds = (gladys, id = SERVER_ID) => gladys.externalIds(SERVER_TYPE, id);
export const clientIds = (gladys, key) => gladys.externalIds(CLIENT_TYPE, key);

/** The client key of a device external id, null when it is not a client device. */
export function clientKeyOf(gladys, externalId) {
  const prefix = clientIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const key = externalId.slice(prefix.length);
  return /^[0-9a-f]{64}$/.test(key) ? key : null;
}

export const serverName = (url) => `wg-easy ${hostOf(url)}`;
export const clientName = (client) => `${client.name} (VPN)`;

/** Discovery payload of the server device. */
export function buildServerDevice(gladys, { url, language = 'en', id = SERVER_ID }) {
  const ids = serverIds(gladys, id);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: serverName(url),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: URL_PARAM, value: url }],
    features: SERVER_FEATURES.map(({ key }) => ({
      ...counter(),
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/** Discovery payload of a client device. */
export function buildClientDevice(gladys, client, { language = 'en', allowControl = false } = {}) {
  const ids = clientIds(gladys, client.key);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: clientName(client),
    external_id: ids.device,
    should_poll: false,
    params: client.address ? [{ name: ADDRESS_PARAM, value: client.address }] : [],
    features: CLIENT_FEATURES.map(({ key, definition }) => ({
      ...definition({ allowControl }),
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature of a client (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|string|null }>}
 */
export function clientValues(gladys, client, { now, language = 'en' }) {
  const ids = clientIds(gladys, client.key);
  return CLIENT_FEATURES.map(({ key, value }) => ({
    key,
    externalId: ids.feature(key),
    value: value({ client, now, language }),
  }));
}

/** The value of every feature of the server. */
export function serverValues(gladys, clients, { now, id = SERVER_ID }) {
  const ids = serverIds(gladys, id);
  return SERVER_FEATURES.map(({ key, value }) => ({
    key,
    externalId: ids.feature(key),
    value: value({ clients, now }),
  }));
}
