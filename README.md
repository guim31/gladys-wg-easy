# WireGuard (wg-easy) for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for
[wg-easy](https://github.com/wg-easy/wg-easy), the web interface of WireGuard:
who is connected to the VPN of your home, right in Gladys.

## Features

- **One device per VPN client**: connected (handshake less than 3 minutes
  old), access enabled (a switch, read only unless allowed in the
  configuration), data received and sent by the client (MB), date of the last
  handshake.
- **One device for the server**: connected clients, clients.
- **Dashboard widget** _VPN clients_: who is connected, when the others were
  last seen, who is disabled.
- **Scene triggers**: _VPN client connected_, _VPN client disconnected_ (for one
  client or any), _wg-easy no longer answers_, _wg-easy answers again_.
- **wg-easy v15 and v14**, found by themselves; a client keeps its device when
  moving from v14 to v15 (it is identified by its WireGuard public key).
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- wg-easy v15 (15.0 to 15.4: user name and password of a user without
  two-factor authentication) or v14 (password), reachable from Gladys on the
  local network.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-wg-easy`.
2. In the **Configuration** screen, enter the address of the wg-easy web
   interface (`192.168.1.2:51821`), the user name (v15) and the password, then
   **Test the connection**.
3. In the **Discovery** tab, add the server and the clients to follow.

The full documentation, shown by Gladys, is in [`docs/`](docs/en.md)
([fr](docs/fr.md), [de](docs/de.md), [es](docs/es.md)).

## How it works

- The integration reads `GET /api/client` (v15, HTTP basic authentication) or
  `GET /api/wireguard/client` (v14, the password in the `Authorization`
  header) every 15, 30 or 60 seconds, on its own timer (the devices are
  published with `should_poll: false`). No session to keep, nothing written to
  `/data`.
- A client is **connected** when it is enabled and its last handshake is less
  than 3 minutes old: WireGuard renews the handshake every 2 minutes while
  packets flow.
- Enabling or disabling a client calls `POST /api/client/{id}/enable|disable`
  (v15) or `/api/wireguard/client/{id}/enable|disable` (v14), only when the
  configuration allows it.

## Checked on a real wg-easy

Run in Docker, on a dedicated network, with no port published:

- wg-easy **15.4.0** (unattended setup) and a real WireGuard client
  (`linuxserver/wireguard`) for a real handshake: the client list, basic
  authentication, the answers to a missing or wrong password, the v14 path on
  a v15, enable and disable. The answers are recorded, anonymized, in
  `test/fixtures/wg-easy/`.
- wg-easy **14**: the client list with the password header, the HTTP 500 its
  middleware answers to a missing or wrong password, an unknown client.
- The integration image, under the constraints of the Gladys sandbox
  (read-only root, no capability, 256 MB), reading both servers.

Not checked: a real Gladys instance (the tests use the fake Gladys of the SDK),
two-factor authentication and `DISABLE_PASSWORD_AUTH` (inferred from the
wg-easy source code).

## Limitations

- 10 wg-easy servers at most: the one of the configuration and 9 added by the
  "Add a wg-easy server" action.
- "Connected" is deduced from the last handshake: a client that sends nothing
  (no _Persistent keepalive_) counts as disconnected after 3 minutes.
- The data counters are those of the WireGuard interface and restart from zero
  when wg-easy restarts.
- No creation, deletion or renaming of clients, no QR code: that stays in
  wg-easy.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory wg-easy (`test/helpers/fakeWgEasy.js`) built from the answers
of real servers (`test/fixtures/wg-easy/`). See [`CLAUDE.md`](CLAUDE.md) for
the project rules.

## Credits

- [wg-easy](https://github.com/wg-easy/wg-easy) by Emile Nijssen and
  contributors (AGPL-3.0): this integration only talks to its HTTP API; the
  behaviour of the API was read in its source code, no code was copied.
- [WireGuard](https://www.wireguard.com) by Jason A. Donenfeld.
- The architecture and the conformity tests follow
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by wg-easy or
WireGuard. "WireGuard" is a registered trademark of Jason A. Donenfeld.

## License

Apache-2.0
