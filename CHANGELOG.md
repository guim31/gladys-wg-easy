# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]

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
