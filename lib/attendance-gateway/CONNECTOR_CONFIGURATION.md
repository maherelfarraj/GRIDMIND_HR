# Attendance Connector Configuration

## Production configuration rule

Deploy one gateway per site or network trust zone. The gateway is the only
component permitted to communicate with attendance devices or vendor
middleware. It stores an encrypted local queue and sends signed batches to
GridMind HR; the HR core does not open inbound connections to site devices.

Use `./.env.example` as the starting point. Set real secrets through the
customer's approved secret-management process, never in source control.

## Supported connectors

| Connector | Status | Best use |
| --- | --- | --- |
| `ZKTECO` | Operational | ZKBioTime/BioTime middleware API; preferred for a fleet of ZKTeco terminals. |
| `ZKTECO_NATIVE` | Operational, site validation required | Older standalone ZKTeco terminals on the local network. |
| `SUPREMA` | Operational | BioStar 2 Local API; preferred for a fleet of Suprema devices. |
| `SUPREMA_NATIVE` | Conditional | Requires the customer's licensed and vendor-supported Device SDK binding. |
| `GENERIC_REST` | Operational | Middleware exposing the documented `/health` and cursor-based `/punches` contract. |
| `CSV` | Operational | Fully offline, manual import of legacy terminal exports. |
| `SIMULATOR` | Development only | Never register for a production device. |

Hikvision, Virdi, Anviz, database, SFTP, webhook, OSDP and Wiegand are not
currently selectable adapters. Do not register them as a generic adapter and
claim compatibility. They require certified adapters following the contract
below.

## Site commissioning checklist

1. Register the gateway from the authenticated GridMind HR administration UI.
2. Copy the one-time gateway secret to the local protected environment file.
3. Configure a dedicated, least-privilege vendor account that can read events
   but cannot enroll, delete, or export biometric templates.
4. Set the same approved IANA time zone and NTP source on the gateway,
   devices, and vendor middleware.
5. Run the connection test and correct a clock skew over 60 seconds before
   enabling production polling. The gateway blocks polling at the configured
   hard limit (default five minutes).
6. Verify a real punch, a same-second double punch, and a gateway restart
   during backlog replay.
7. Verify that event metadata has no fingerprint template, facial image, or
   biometric vector.
8. Keep the local operator API on loopback. Remote administration requires a
   private management network and an authenticated TLS reverse proxy.

## New adapter certification contract

New adapters must implement `DeviceAdapter` and be certified before appearing
in the registration UI. Each adapter must provide:

- Stable native event IDs and a lossless opaque cursor.
- Event normalization to GridMind's six punch types.
- Explicit device/site time-zone handling.
- Health and clock-skew reporting.
- Whitelisted scalar metadata only; no biometric data.
- Replay-safe deduplication and encrypted offline spooling.
- Authentication using least privilege and secrets held only on the site.

For Wiegand and OSDP, integrate at the access-control controller or its
central server. Do not wire reader signals directly into the HR application.
OSDP Secure Channel should be the default for new reader installations;
Wiegand is legacy compatibility only.
