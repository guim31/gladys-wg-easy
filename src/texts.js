// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, command
// errors. Four languages, the four of the Gladys interface; German says "du",
// Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { COMMAND_ERRORS, ERROR_KINDS } from './wgeasy/client.js';

/** The text of `language`, English when missing. */
export const pick = (text, language) =>
  typeof text === 'string' ? text : (text?.[language] ?? text?.en ?? '');

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your wg-easy in the configuration.',
    fr: "Saisissez l'adresse de votre wg-easy dans la configuration.",
    de: 'Gib die Adresse deines wg-easy in der Konfiguration ein.',
    es: 'Introduzca la dirección de su wg-easy en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:51821',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:51821',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:51821',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:51821',
  },
};

// One short explanation per error kind (src/wgeasy/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'wg-easy does not answer',
    fr: 'wg-easy ne répond pas',
    de: 'wg-easy antwortet nicht',
    es: 'wg-easy no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user name or password refused (or two-factor authentication on)',
    fr: 'identifiant ou mot de passe refusé (ou double authentification active)',
    de: 'Benutzername oder Passwort abgelehnt (oder Zwei-Faktor-Authentifizierung aktiv)',
    es: 'usuario o contraseña rechazados (o autenticación de dos factores activa)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'access refused: password login disabled or user disabled',
    fr: 'accès refusé : connexion par mot de passe désactivée ou utilisateur désactivé',
    de: 'Zugriff verweigert: Passwort-Anmeldung oder Benutzer deaktiviert',
    es: 'acceso denegado: inicio de sesión con contraseña o usuario desactivado',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: use https:// or the final address',
    fr: "l'adresse redirige : utilisez https:// ou l'adresse finale",
    de: 'die Adresse leitet um: Verwende https:// oder die endgültige Adresse',
    es: 'la dirección redirige: use https:// o la dirección final',
  },
  [ERROR_KINDS.NOT_WGEASY]: {
    en: 'no wg-easy API at this address (v14 or v15 expected)',
    fr: "pas d'API wg-easy à cette adresse (v14 ou v15 attendue)",
    de: 'keine wg-easy-API unter dieser Adresse (v14 oder v15 erwartet)',
    es: 'no hay API de wg-easy en esta dirección (se espera v14 o v15)',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer from wg-easy',
    fr: 'réponse inattendue de wg-easy',
    de: 'unerwartete Antwort von wg-easy',
    es: 'respuesta inesperada de wg-easy',
  },
};

export const COMMAND_TEXT = {
  readOnly: {
    en: 'Controlling the clients is off: tick "Allow enabling and disabling clients" in the configuration.',
    fr: "Le pilotage des clients est désactivé : cochez « Autoriser l'activation et la désactivation des clients » dans la configuration.",
    de: 'Die Steuerung der Clients ist aus: Aktiviere „Aktivieren und Deaktivieren der Clients erlauben“ in der Konfiguration.',
    es: 'El control de los clientes está desactivado: marque «Permitir habilitar y deshabilitar clientes» en la configuración.',
  },
  unknownClient: {
    en: 'This client no longer exists in wg-easy.',
    fr: "Ce client n'existe plus dans wg-easy.",
    de: 'Dieser Client existiert in wg-easy nicht mehr.',
    es: 'Este cliente ya no existe en wg-easy.',
  },
  [COMMAND_ERRORS.EXPIRED]: {
    en: 'This client has expired: change its expiration date in wg-easy first.',
    fr: "Ce client a expiré : changez d'abord sa date d'expiration dans wg-easy.",
    de: 'Dieser Client ist abgelaufen: Ändere zuerst sein Ablaufdatum in wg-easy.',
    es: 'Este cliente ha caducado: cambie primero su fecha de caducidad en wg-easy.',
  },
};

// "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (version, clients, connected) =>
      `wg-easy v${version} answers: ${clients} client(s), ${connected} connected.`,
  },
  fr: {
    ok: (version, clients, connected) =>
      `wg-easy v${version} répond : ${clients} client(s), ${connected} connecté(s).`,
  },
  de: {
    ok: (version, clients, connected) =>
      `wg-easy v${version} antwortet: ${clients} Client(s), ${connected} verbunden.`,
  },
  es: {
    ok: (version, clients, connected) =>
      `wg-easy v${version} responde: ${clients} cliente(s), ${connected} conectado(s).`,
  },
};

/** The text of an error of the client, in `language`. */
export function errorText(err, language) {
  if (err.kind === COMMAND_ERRORS.UNKNOWN_CLIENT) {
    return pick(COMMAND_TEXT.unknownClient, language);
  }
  return pick(COMMAND_TEXT[err.kind] ?? ERROR_TEXT[err.kind] ?? ERROR_TEXT.http, language);
}

/**
 * A text table of the servers' actions, filled: each language is a string or
 * a function of `params`.
 */
export function render(table, params = {}) {
  return Object.fromEntries(
    Object.entries(table).map(([language, text]) => [
      language,
      typeof text === 'function' ? text(params) : text,
    ]),
  );
}

// The configuration actions of the servers (add, remove, show).
export const SERVER_TEXT = {
  added: {
    en: ({ name }) => `${name} added.`,
    fr: ({ name }) => `${name} ajouté.`,
    de: ({ name }) => `${name} hinzugefügt.`,
    es: ({ name }) => `${name} añadido.`,
  },
  updated: {
    en: ({ name }) => `${name} updated.`,
    fr: ({ name }) => `${name} mis à jour.`,
    de: ({ name }) => `${name} aktualisiert.`,
    es: ({ name }) => `${name} actualizado.`,
  },
  read: {
    en: ({ clients }) => `It answers: ${clients} client(s). Open the Discover tab to add them.`,
    fr: ({ clients }) =>
      `Il répond : ${clients} client(s). Ouvrez l'onglet Découverte pour les ajouter.`,
    de: ({ clients }) =>
      `Er antwortet: ${clients} Client(s). Öffne den Tab „Entdecken“, um sie hinzuzufügen.`,
    es: ({ clients }) =>
      `Responde: ${clients} cliente(s). Abra la pestaña Descubrir para añadirlos.`,
  },
  inConfig: {
    en: ({ name }) => `${name} is the server of the configuration: change it there.`,
    fr: ({ name }) => `${name} est le serveur de la configuration : modifiez-le là.`,
    de: ({ name }) => `${name} ist der Server der Konfiguration: Ändere ihn dort.`,
    es: ({ name }) => `${name} es el servidor de la configuración: cámbielo allí.`,
  },
  tooMany: {
    en: ({ max }) => `At most ${max} servers on top of the one of the configuration.`,
    fr: ({ max }) => `Au plus ${max} serveurs en plus de celui de la configuration.`,
    de: ({ max }) => `Höchstens ${max} Server zusätzlich zu dem der Konfiguration.`,
    es: ({ max }) => `Como máximo ${max} servidores además del de la configuración.`,
  },
  unknown: {
    en: ({ query, servers }) => `No server "${query}". Servers: ${servers}.`,
    fr: ({ query, servers }) => `Aucun serveur « ${query} ». Serveurs : ${servers}.`,
    de: ({ query, servers }) => `Kein Server „${query}“. Server: ${servers}.`,
    es: ({ query, servers }) => `Ningún servidor «${query}». Servidores: ${servers}.`,
  },
  removeConfig: {
    en: ({ name }) => `${name} is the server of the configuration: empty its address there.`,
    fr: ({ name }) => `${name} est le serveur de la configuration : videz son adresse là.`,
    de: ({ name }) => `${name} ist der Server der Konfiguration: Leere dort seine Adresse.`,
    es: ({ name }) => `${name} es el servidor de la configuración: vacíe allí su dirección.`,
  },
  removed: {
    en: ({ name }) => `${name} removed. Delete its devices in Gladys if needed.`,
    fr: ({ name }) => `${name} retiré. Supprimez ses appareils dans Gladys si besoin.`,
    de: ({ name }) => `${name} entfernt. Lösche seine Geräte in Gladys, falls nötig.`,
    es: ({ name }) => `${name} eliminado. Borre sus dispositivos en Gladys si hace falta.`,
  },
  waiting: {
    en: 'not read yet',
    fr: 'pas encore lu',
    de: 'noch nicht gelesen',
    es: 'aún sin leer',
  },
};
