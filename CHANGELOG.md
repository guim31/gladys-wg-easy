# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.1.0] - 2026-10-17

### Added

- Several wg-easy servers: "Add a wg-easy server", "Remove a wg-easy server"
  and "Show the servers" watch other wg-easy on top of the one of the
  configuration. Each server has its own server device and clients; the scene
  triggers say the server and can be limited to one; the widget lists the
  clients of every server and the ones that do not answer.

## [1.0.0] - 2026-10-17

### Added

- One device per WireGuard client of wg-easy: connected (handshake less than
  3 minutes old), access enabled, data received and sent by the client (MB),
  date of the last handshake.
- One device for the wg-easy server: connected clients, clients.
- Optional control of the clients: the "Access enabled" switch enables or
  disables a client in wg-easy once allowed in the configuration (read only by
  default).
- Dashboard widget "VPN clients": who is connected, when the others were last
  seen, who is disabled.
- Scene triggers: VPN client connected, VPN client disconnected, wg-easy no
  longer answers, wg-easy answers again.
- wg-easy v15 (user name and password) and v14 (password), found by
  themselves; a client keeps its device from v14 to v15.
- "Test the connection" action, and texts, feature names and documentation in
  English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-wg-easy/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/guim31/gladys-wg-easy/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/guim31/gladys-wg-easy/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/guim31/gladys-wg-easy/releases/tag/v1.0.0
