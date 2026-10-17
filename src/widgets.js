// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `clients`.
//
// The use case: "who is on the home VPN right now?" at a glance. Two tiles
// (connected clients, clients) and one status list: the connected clients
// first, then the others with the time of their last handshake, the
// disabled ones last. No button: enabling or disabling a client is the
// device switch (off by default), not a tap on a wall tablet.
//
// Budget (8 components, 2 texts at most): 2 values and 1 status list, or a
// single text when there is nothing to show. The values are sent as values,
// not bound to device features, so the widget works before the devices are
// added to Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { CONNECTION_TEXT, ERROR_TEXT, pick } from './texts.js';

// Rows of the status list (one more says how many are not shown).
export const MAX_ROWS = 9;

export const TEXT = {
  connected: { en: 'Connected', fr: 'Connectés', de: 'Verbunden', es: 'Conectados' },
  clients: { en: 'Clients', fr: 'Clients', de: 'Clients', es: 'Clientes' },
  online: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  never: {
    en: 'No handshake known',
    fr: 'Aucun handshake connu',
    de: 'Kein Handshake bekannt',
    es: 'Ningún handshake conocido',
  },
  disabled: { en: 'Disabled', fr: 'Désactivé', de: 'Deaktiviert', es: 'Deshabilitado' },
  more: { en: 'Other clients', fr: 'Autres clients', de: 'Weitere Clients', es: 'Otros clientes' },
  empty: {
    en: 'No client in wg-easy yet.',
    fr: 'Aucun client dans wg-easy pour le moment.',
    de: 'Noch kein Client in wg-easy.',
    es: 'Todavía no hay ningún cliente en wg-easy.',
  },
  waiting: {
    en: 'Waiting for the first reading of wg-easy…',
    fr: 'En attente de la première lecture de wg-easy…',
    de: 'Warte auf die erste Abfrage von wg-easy…',
    es: 'Esperando la primera lectura de wg-easy…',
  },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** "5 min ago", "2 h ago", "3 days ago", in the language of the dashboard. */
export function ago(time, now, language) {
  const minutes = Math.max(1, Math.round((now - time) / 60_000));
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'always', style: 'short' });
  if (minutes < 60) {
    return format.format(-minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return format.format(-hours, 'hour');
  }
  return format.format(-Math.round(hours / 24), 'day');
}

/** Order: connected (by name), enabled (latest handshake first), disabled. */
function rank({ client, connected }) {
  if (connected) {
    return 0;
  }
  return client.enabled ? 1 : 2;
}

export function sortEntries(entries) {
  return [...entries].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 1 ? (b.client.seenAt ?? 0) - (a.client.seenAt ?? 0) : 0) ||
      a.client.name.localeCompare(b.client.name),
  );
}

function row({ client, connected }, now, language) {
  const label = fit(client.name, 40);
  if (connected) {
    return {
      label,
      icon: 'wifi',
      value: pick(TEXT.online, language),
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  if (!client.enabled) {
    return {
      label,
      icon: 'slash',
      value: pick(TEXT.disabled, language),
      color: WIDGET_COLORS.WARNING,
    };
  }
  return {
    label,
    icon: 'wifi-off',
    value: fit(
      client.seenAt === null || client.seenAt === undefined
        ? pick(TEXT.never, language)
        : ago(client.seenAt, now, language),
      40,
    ),
    color: WIDGET_COLORS.NEUTRAL,
  };
}

async function get(hub, { language = 'en' } = {}) {
  const { config } = hub;
  if (!config?.url) {
    return message(
      config?.invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      language,
    );
  }
  if (hub.error) {
    return {
      ttl_seconds: 30,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: pick(ERROR_TEXT[hub.error.kind] ?? ERROR_TEXT.http, language),
        },
      ],
    };
  }
  if (!hub.read) {
    return message(TEXT.waiting, language);
  }
  const entries = sortEntries(hub.clients.values());
  if (entries.length === 0) {
    return message(TEXT.empty, language);
  }
  const now = hub.now();
  const connected = entries.filter((entry) => entry.connected).length;
  const shown = entries.length > MAX_ROWS + 1 ? entries.slice(0, MAX_ROWS) : entries;
  const items = shown.map((entry) => row(entry, now, language));
  if (shown.length < entries.length) {
    items.push({
      label: pick(TEXT.more, language),
      icon: 'more-horizontal',
      value: entries.length - shown.length,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return {
    ttl_seconds: 30,
    components: [
      {
        type: 'value',
        value: connected,
        label: pick(TEXT.connected, language),
        icon: 'users',
        color: connected > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
      },
      {
        type: 'value',
        value: entries.length,
        label: pick(TEXT.clients, language),
        icon: 'shield',
      },
      { type: 'status', items },
    ],
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
