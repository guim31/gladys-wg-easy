// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One wg-easy server: its address, the login of a wg-easy user (v15) and its
// password (v15 and v14).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds. A client counts
// as connected for 3 minutes after its last handshake: reading more often
// than every 15 seconds would not tell more.
export const POLL_INTERVALS = ['15', '30', '60'];

export const DEFAULT_CONFIG = {
  url: '',
  username: 'admin',
  password: '',
  allow_self_signed: false,
  poll_interval: '30',
  allow_control: false,
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:51821`), or the URL copied from the browser
 * (`https://vpn.example.com/clients`). HTTP by default, the path dropped
 * (wg-easy serves its API at the root).
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  return url.origin;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

const isTrue = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = typeof source.url === 'string' ? source.url.trim() : '';
  const url = parseServerUrl(typed);
  const interval = POLL_INTERVALS.includes(String(source.poll_interval ?? ''))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  return {
    url,
    invalidUrl: typed !== '' && url === null,
    username:
      typeof source.username === 'string' && source.username.trim()
        ? source.username.trim()
        : DEFAULT_CONFIG.username,
    // Passwords are kept as typed: spaces may be part of them.
    password: typeof source.password === 'string' ? source.password : '',
    allowSelfSigned: isTrue(source.allow_self_signed),
    pollIntervalMs: Number(interval) * 1000,
    allowControl: isTrue(source.allow_control),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
