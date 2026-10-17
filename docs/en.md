# WireGuard (wg-easy)

Know who is connected to the WireGuard VPN of your home from Gladys, when your
VPN is managed by [wg-easy](https://github.com/wg-easy/wg-easy): one device per
VPN client (connected or not, data received and sent, last handshake), a
dashboard widget, and scene triggers when a client connects or disconnects —
for instance to know that someone opened the VPN of the house while you are
away.

Tested against real wg-easy 15.4 and 14 servers in Docker, with a real
WireGuard client. Feedback is welcome on the
[Gladys forum](https://community.gladysassistant.com) or in the
[issues](https://github.com/guim31/gladys-wg-easy/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- **wg-easy v15** (15.0 to 15.4) or **v14**, reachable from Gladys over your
  local network (port 51821 of its web interface by default).
- For v15: the user name and password of a wg-easy user **without two-factor
  authentication** (wg-easy refuses password access to the API for such a
  user). An admin sees every client; another user only their own. Password
  access must not be disabled (`DISABLE_PASSWORD_AUTH`).
- For v14: the password of the web interface, or nothing if it has none.

## Set up

1. In Gladys, install the integration, then open its **Configuration** screen.
2. **Address**: the address of the wg-easy web interface, for instance
   `192.168.1.2:51821`, with `https://` if it is served over HTTPS (behind a
   reverse proxy, for instance). The path is ignored.
3. **User name (v15)**: `admin` by default; ignored by v14.
4. **Password**: the password of this user (v15) or of the web interface (v14).
5. **Accept self-signed certificates**: only for an `https://` address whose
   certificate is not signed by a known authority.
6. **Refresh interval**: how often wg-easy is read, 30 s by default. Each
   reading checks the password on the wg-easy side (argon2 on v15, a fraction
   of a second of processor time).
7. **Allow enabling and disabling clients**: off by default. See below.
8. **Language of the names**: the language of the feature names and of the
   date of the last handshake, set when a device is added.
9. Save, then use **Test the connection**: it answers with the version of
   wg-easy, the number of clients and how many are connected.
10. In the **Discovery** tab, add the server and the clients you want to
    follow.

The version (v15 or v14) is found by itself. The scene triggers and the widget
work even for clients you did not add to Gladys.

## The devices

**The server** (`wg-easy` followed by its address):

| Feature           | What it shows                 |
| ----------------- | ----------------------------- |
| Connected clients | Clients connected right now   |
| Clients           | Clients configured in wg-easy |

**Each VPN client** (its wg-easy name followed by `(VPN)`):

| Feature                | What it shows                                                                    |
| ---------------------- | -------------------------------------------------------------------------------- |
| Connected              | Yes when the last handshake is less than 3 minutes old and the client is enabled |
| Access enabled         | Whether the client is enabled in wg-easy (a switch, read only by default)        |
| Received by the client | Data the client downloaded through the VPN, in MB                                |
| Sent by the client     | Data the client uploaded through the VPN, in MB                                  |
| Last handshake         | Date and time of the last WireGuard handshake seen (empty until then)            |

**Connected** follows WireGuard itself: while packets flow, the client renews
its handshake every 2 minutes. A client that stops sending anything (a phone
asleep, without _Persistent keepalive_) counts as disconnected 3 minutes after
its last handshake, even if its tunnel is still "on" on the phone.

The data counters are those of the WireGuard interface: they restart from zero
when wg-easy or its interface restarts, and are unknown for a disabled client.

wg-easy forgets the last handshake of a client that is disabled or enabled
again: the integration keeps showing the last one it saw.

**Access enabled** is read only unless you tick **Allow enabling and disabling
clients**. Once ticked, Gladys, its scenes and voice assistants can cut the
access of a client (for instance the VPN profile of a child, in the evening).
Leave it off if you do not need it: it is your VPN access from outside. After
changing this option, use **Update** in the Discovery tab for the switch to
change in Gladys.

A client is identified by its WireGuard public key: renaming it in wg-easy, or
migrating from v14 to v15, keeps the device and its history.

## Dashboard

The **VPN clients** widget shows the number of connected clients and of
clients, then one row per client: the connected ones first (_Connected_), then
the others with the time since their last handshake (_2 hr. ago_ or _No handshake known_), the disabled ones last (_Disabled_). Ten rows at most; beyond,
the last row counts the other clients.

## Scenes

### Triggers

- **VPN client connected**: a client connected to the VPN of the home (a first
  handshake after 3 minutes of silence). Filter: one client, or any. Variables:
  client name, client device.
- **VPN client disconnected**: a client has had no handshake for 3 minutes, or
  was disabled. Filter: one client, or any. Variables: client name, client
  device, minutes connected.
- **wg-easy no longer answers**: wg-easy stopped answering (two readings in a
  row). Variable: the error.
- **wg-easy answers again**: wg-easy answers again after an outage. Variable:
  minutes without answer.

No event is sent at the start of the integration: the state before is not
known.

### Scene ideas

- **Someone opened the VPN of the house**: _VPN client connected_ (any client)
  → send a message "{{client}} is connected to the home VPN".
- **The child's phone is still on the VPN at night**: _VPN client connected_,
  the child's phone, between 22:00 and 07:00 → turn its _Access enabled_ off
  (with control allowed).
- **The VPN box is down**: _wg-easy no longer answers_ → send a message with the
  error, before you need the VPN from outside.

## Troubleshooting

- **"user name or password refused (or two-factor authentication on)"**: check
  the user name (v15) and the password. wg-easy v15 refuses password access to
  the API for a user with two-factor authentication: create a user without it
  for Gladys.
- **"access refused: password login disabled or user disabled"**: the user is
  disabled, or wg-easy runs with `DISABLE_PASSWORD_AUTH`.
- **"the address redirects"**: the address answers with a redirect, usually
  from HTTP to HTTPS: type the `https://` address.
- **"certificate refused"**: tick **Accept self-signed certificates**.
- **"no wg-easy API at this address"**: the address is not the one of the
  wg-easy web interface (check the port, 51821 by default).
- **A client stays "Connected: No" while its tunnel is on**: it sends nothing.
  Set a _Persistent keepalive_ (25 s) on that client in wg-easy if you want it
  seen as connected while idle.
- **Some clients are missing**: a non-admin wg-easy user only sees its own
  clients: use an admin.

## Limits

- One wg-easy server per Gladys.
- wg-easy v15 and v14 only; the older versions are not supported.
- "Connected" is deduced from the last handshake (3 minutes): a client that
  sends nothing counts as disconnected, a disconnection is seen up to 3 minutes
  plus one reading later.
- The date of the last handshake uses the clock of wg-easy; the 3 minutes are
  counted with the clock of Gladys: keep both on time (NTP).
- The data counters restart from zero when wg-easy restarts.
- The integration does not create, delete or rename clients, nor show their QR
  code: that stays in wg-easy.
- Not affiliated with wg-easy or WireGuard. WireGuard is a registered trademark
  of Jason A. Donenfeld.
