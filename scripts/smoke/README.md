# HRMS Admin Smoke Suite

Headless Playwright suite that exercises the five high-risk admin areas after
any deployment or API change.  Runs in ~2 minutes against dev or prod.

---

## Prerequisites

### Dev (default)

| Requirement | How |
|---|---|
| API Server workflow running | Start `artifacts/api-server: API Server` |
| HRMS web workflow running | Start `artifacts/hrms: web` |
| Admin password available | Set at least one credential env var (see below) |

### Prod (post-publish)

| Requirement | How |
|---|---|
| Published app healthy | Verify `https://<your-domain>.replit.app` responds |
| `SMOKE_BASE_URL` set | Export the published URL (see below) |
| `SMOKE_ADMIN_PASSWORD` set | Set to the current prod admin password (see below) |

The suite runs entirely over HTTPS from the Replit workspace — no local
server needs to be started for a prod run.

---

## Target URL — `SMOKE_BASE_URL`

```
SMOKE_BASE_URL=<url> bash scripts/run-smoke.sh
```

| Value | When |
|---|---|
| _(unset)_ | Defaults to `http://localhost:80` — dev mode |
| `https://enterprise-hr-suite.replit.app` | Post-publish prod run |

The env var is forwarded into `playwright.config.ts`, `global-setup.ts`, and
`admin-smoke.spec.ts`.  Setting it once on the command line is sufficient.

---

## Credentials

The suite tries these env vars in order; the first that authenticates cleanly
(HTTP 200, `mustChangePassword=false`) wins.  No value is ever hard-coded.

| Order | Env var | Purpose |
|---|---|---|
| 1 | `SMOKE_ADMIN_PASSWORD` | Dedicated smoke credential — **preferred for prod** |
| 2 | `ADMIN_RESET_PASSWORD` | Operator-supplied reset/temporary password |
| 3 | `DEMO_PILOT_PASSWORD` | Dev seeding password (dev only) |

### Dev credential setup

During development any of the three env vars is sufficient.  If the admin
account was seeded with `DEMO_PILOT_PASSWORD`, just export that value.

### Prod credential setup (post-publish)

1. After the first publish, log in to the prod app manually as `admin` and
   complete the initial password change (clears `mustChangePassword`).
2. Add the resulting password as a Replit Secret named **`SMOKE_ADMIN_PASSWORD`**.
   Secrets are available to the workspace as env vars on next shell session.
3. Run the suite — no further credential work is needed until the password changes.

If `SMOKE_ADMIN_PASSWORD` is not yet set, the suite falls back to
`ADMIN_RESET_PASSWORD` then `DEMO_PILOT_PASSWORD`.  For prod, **only
`SMOKE_ADMIN_PASSWORD` should be set**; the other two names imply dev-only
temporary credentials.

### `mustChangePassword` error

If global-setup fails with:

```
authenticated but mustChangePassword=true
```

The admin password has not yet been changed since provisioning.  You must:

1. Obtain the one-time password from `.credentials/one-time-passwords-*.json`
   (operator-only, mode 0600).
2. Sign in to the app manually and set a permanent password.
3. Update `SMOKE_ADMIN_PASSWORD` to the new password.
4. Re-run the suite.

**The suite will never rotate or reset the password automatically against a
remote target.**  The `SMOKE_ALLOW_PASSWORD_ROTATION=true` opt-in enforces
three independent guards before any network request is made:

| Guard | Condition that blocks rotation |
|---|---|
| Environment | `NODE_ENV=production` or `REPLIT_DEPLOYMENT` is set |
| **Target URL** | `SMOKE_BASE_URL` hostname is not `localhost` or `127.0.0.1` |
| Password | `SMOKE_ROTATION_PASSWORD` is not set |

The target-URL guard is the critical safety net for post-publish runs: the
dev workspace has neither `NODE_ENV=production` nor `REPLIT_DEPLOYMENT` set,
but when `SMOKE_BASE_URL` points at a remote published URL, the URL guard
fires immediately — before any login or change-password request is sent.

Attempting rotation against a remote URL produces:

```
[smoke/global-setup] SMOKE_ALLOW_PASSWORD_ROTATION=true is not permitted
against a remote target.
  Target: https://enterprise-hr-suite.replit.app
  Rotation is only allowed when SMOKE_BASE_URL resolves to localhost or 127.0.0.1.
  To fix: unset SMOKE_ALLOW_PASSWORD_ROTATION, then change the admin password
  manually on the remote app and update SMOKE_ADMIN_PASSWORD accordingly.
```

---

## Running the suite

```bash
# Dev — full suite
bash scripts/run-smoke.sh

# Dev — show browser window (debug a failing test)
bash scripts/run-smoke.sh --headed

# Dev — run one test by name
bash scripts/run-smoke.sh --grep "Attendance Gateway"

# Prod — post-publish smoke run
SMOKE_BASE_URL=https://enterprise-hr-suite.replit.app \
  bash scripts/run-smoke.sh

# Prod — single test against prod
SMOKE_BASE_URL=https://enterprise-hr-suite.replit.app \
  bash scripts/run-smoke.sh --grep "Pilot Control Center"
```

---

## What the suite tests

| Test | Page | Safe mutation exercised |
|---|---|---|
| Pilot Control Center | `/pilot-control-center` | Evaluate All Gates (idempotent re-evaluation) |
| Policy Governance | `/policy-governance` | Create draft PCR → immediately withdraw it |
| Policy Localization | `/policy-localization` | Create numbering scheme → deleted in afterAll |
| Attendance Gateway | `/attendance-gateway` | Create gateway registration → revoked in afterAll |
| Integration Governance | `/integration-governance` | Run health checks (idempotent probe) |

Each test also fails on any console error or 4xx/5xx API response, and
checks that skeleton loaders resolve after network idle.

### Mutations are self-cleaning

Every write operation is paired with a matching delete/revoke/withdraw in the
same test or in `afterAll`.  `beforeAll` also revokes any stale `smoke-test-*`
gateway registrations left by prior crashed runs.  No permanent state
accumulates across runs.

**It is safe to run this suite against the live production app**, provided the
admin account exists and `SMOKE_ADMIN_PASSWORD` is set correctly.  Operators
should be aware that transient records (gateway registrations, PCR drafts,
numbering schemes) are created and immediately removed during the run.

---

## Session state — `auth.json`

`global-setup.ts` writes `scripts/smoke/auth.json` after a successful login.
This file contains the session cookie and localStorage token for the target
app.

- `auth.json` is listed in `.gitignore` and **must never be committed**.
- It is valid only for one session on one target origin.  If you switch between
  dev and prod targets, auth.json is automatically overwritten by the next run.
- Running dev and prod simultaneously from the same workspace is not supported
  (they share the same `auth.json` path).

---

## Hardening — recommended next step

The suite currently uses the shared `admin` account.  For stronger isolation
on production, create a dedicated `smoke-admin` user with:

- Role: `admin` (sufficient for all tested pages)
- A strong password stored only in `SMOKE_ADMIN_PASSWORD`
- No access to sensitive HR data outside the admin pages

This ensures the smoke credential can be rotated or revoked independently of
the operator admin account, and limits blast radius if the secret leaks.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `PLAYWRIGHT_CHROMIUM_PATH is not set` | Run directly with `node`/`npx` instead of `run-smoke.sh` | Always invoke via `bash scripts/run-smoke.sh` |
| `No admin password available` | None of the three credential env vars is set | Export at least `SMOKE_ADMIN_PASSWORD` |
| `mustChangePassword=true` | Admin account requires password change | Log in manually, change password, update secret |
| `SMOKE_ALLOW_PASSWORD_ROTATION=true is not permitted in production` | Rotation flag set in prod environment | Unset the flag; change password manually |
| Tests fail with 401 on API calls | auth.json is stale (session expired) | Re-run the suite — global-setup refreshes auth.json |
| Tests fail with connection refused | Target URL unreachable | Verify the workflow/deployment is healthy |
