# On-Site Runbook: Native ZKTeco / Suprema Device Protocols

This runbook is for the engineer deploying the attendance gateway at a site
that runs **bare devices with no vendor middleware server** (no ZKBioTime /
BioTime, no BioStar 2). It documents everything needed to implement and
validate a native-protocol adapter as a plug-in, without touching the rest of
the pipeline.

> **Why this is on-site work.** Physical terminals must be tested on the local
> network. The ZKTeco native adapter uses the implemented standalone protocol
> client and requires device-specific validation; the Suprema native path also
> requires a licensed, vendor-supported Device SDK binding. Neither can be
> validated from a cloud environment.

## What already works (do not reimplement)

- **Middleware REST adapters** (`src/adapters/vendorStubs.ts`): fully
  operational against ZKBioTime (`/iclock/api/transactions/`) and BioStar 2
  (`/api/events/search`). If the site can run either middleware, prefer that
  path — it needs no SDK license.
- **Encrypted queue + signed HrClient pipeline** (`src/queue.ts`,
  `src/hrClient.ts`, `src/service.ts`): adapter output is spooled to an
  encrypted on-disk queue and flushed to the HR core with HMAC-signed
  requests. A native adapter plugs in *before* this pipeline and must not
  change it.
- **Cursor persistence**: `GatewayService` persists the adapter's opaque
  cursor to `device-cursor.json` and hands it back on the next poll.
- **Server-side dedupe**: the HR core dedupes on `deviceEventUid`, so modest
  event replay from the adapter is harmless.

## Adapter contract

Implement `DeviceAdapter` from `src/types.ts`:

```ts
interface DeviceAdapter {
  readonly type: "ZKTECO" | "SUPREMA" | ...;
  testConnection(): Promise<AdapterTestResult>;
  poll(sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }>;
}
```

Rules a native adapter MUST follow:

1. **Sanitization — non-negotiable.** No biometric templates, fingerprint
   minutiae, face images, or card raw data may ever appear in `GatewayPunch`.
   Reduce vendor records to a whitelist of scalar metadata fields, then pass
   the result through `sanitizeRaw()` (`src/adapters/genericRest.ts`) as a
   second line of defense — mirror `pickMeta()` in `vendorStubs.ts`.
2. **Stable `deviceEventUid`.** Derive from the device serial + native record
   index (e.g. `zk-native-<sn>-<index>`) so replays dedupe server-side.
3. **Lossless cursor.** The cursor is an opaque string owned by the adapter.
   Reuse the `CursorToken` / `BoundaryTracker` pattern from `vendorStubs.ts`
   (export them if needed): timestamp watermark + ids-at-boundary +
   continuation, so same-second events and interrupted drains never lose
   punches. For ZKTeco native, the attendance-log record index is a natural
   monotonic cursor.
4. **Fail loudly.** When the SDK/driver is missing or the device is
   unreachable, `testConnection()` returns
   `{ ok: false, requiresVendorSdk: true, message }` and `poll()` throws.
   Never return an empty success.
5. **Event-type mapping.** Map vendor punch states to `PunchEventType`
   (`CLOCK_IN`, `CLOCK_OUT`, `BREAK_START`, `BREAK_END`, `OVERTIME_START`,
   `OVERTIME_END`). ZKTeco native status codes 0–5 match the middleware
   mapping in `ZK_PUNCH_STATE`; Suprema T&A keys 1–6 match `BIOSTAR_TNA_KEY`.
6. **Timestamps to ISO 8601.** Normalize timestamps with
   `toIsoTimestamp()` so conversion is independent of the gateway host.
   Timezone-less vendor values are treated as UTC; explicit `Z` or numeric
   offsets are preserved and converted to UTC.

## Wiring

- Add the adapter under `src/adapters/` (e.g. `zktecoNative.ts`,
  `supremaNative.ts`) with an env-driven factory
  (`zktecoNativeConfigFromEnv()`), following `vendorStubs.ts`.
- Register it in `buildAdapter()` in `src/index.ts` behind new
  `GATEWAY_ADAPTER` values (e.g. `ZKTECO_NATIVE`, `SUPREMA_NATIVE`) so the
  existing middleware values stay untouched.
- Suggested env: `ZKTECO_DEVICE_HOST`, `ZKTECO_DEVICE_PORT` (default 4370),
  `ZKTECO_COMM_KEY`; `SUPREMA_DEVICE_HOST`, `SUPREMA_DEVICE_PORT`
  (default 51211), plus SDK-specific credential/cert paths.

## On-site prerequisites

- Gateway host on the same L2/L3 network as the device(s); firewall open for
  TCP 4370 (ZKTeco) or TCP 51211/51212 (Suprema).
- For Suprema native only: a licensed BioStar 2 Device SDK and a
  vendor-supported language binding installed on the gateway host.
- Device comm key / admin password from the site administrator.
- At least one enrolled test user on the device.

## Validation checklist (must all pass before go-live)

1. `testConnection()` returns `ok: true` with a plausible `deviceTimeMs`;
   device clock skew vs gateway host < 60s. No SSH needed: the local
   `GET /status` endpoint surfaces `sdk_present`, `sdk_version`,
   `last_test_connection`, and `clock_skew_ms` (plus a `clock_skew_warning`
   field when skew exceeds 60s). This is also enforced continuously at
   runtime: adapters report `clockSkewMs` from every successful
   `testConnection()`, the gateway logs a structured `device_clock_skew`
   warning and flags the heartbeat when skew exceeds `CLOCK_SKEW_WARN_MS`
   (default 60s), and blocks `poll()` entirely when it exceeds
   `CLOCK_SKEW_MAX_MS` (default 5 min) until the device clock is
   corrected — so a drifting clock can never silently skew punch records.
2. Physical punch on the device appears in the HR core with the correct
   employee mapping, event type, and timestamp within one poll interval.
3. Same-second double punch: both events arrive (no cursor loss).
4. Restart the gateway process mid-backlog: no events lost, no duplicates in
   the HR core (`deviceEventUid` dedupe absorbs replay).
5. Unplug the device network cable: `testConnection()` reports failure,
   `poll()` throws, queue keeps previously spooled batches; reconnect and
   confirm catch-up from the persisted cursor.
6. **Sanitization audit:** inspect a spooled batch (decrypt with the queue
   key on the gateway host) and confirm `raw` contains only whitelisted
   scalar metadata — no template/image/binary fields.
7. Run the existing adapter test suites
   (`src/adapters/__tests__`, `src/__tests__`) plus new unit tests for the
   native adapter's cursor and mapping logic (mock the SDK layer).
