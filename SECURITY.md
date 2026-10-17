# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the wg-easy password is a `secret` field of the Gladys
  configuration. The integration reads it from Gladys at startup, keeps it in
  memory, sends it only to the wg-easy address typed in the configuration (in
  the `Authorization` header of each request: HTTP basic authentication on
  v15, the password itself on v14), and never writes it to `/data` nor to the
  logs. Use HTTPS if the path between Gladys and wg-easy is not trusted.
- **Stored in `/data`**: nothing.
- **Network**: requests go only to the wg-easy address of the configuration,
  on the local network, in HTTP or HTTPS. HTTPS certificates are verified
  unless the user ticks "Accept self-signed certificates"; the integration
  opens no port and calls no cloud service.
- **Control**: enabling or disabling a VPN client from Gladys is off by
  default and must be allowed in the configuration.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
wg-easy and WireGuard themselves, and the other devices and services of your
network.
