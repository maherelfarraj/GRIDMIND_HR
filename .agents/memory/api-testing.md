---
name: API integration testing conventions
description: How the api-server vitest suite is structured and kept safe against the shared seeded DB
---

## Test suite conventions
Integration tests live in `artifacts/api-server/src/__tests__/` and run with `pnpm test` (root) → vitest via supertest against the in-process Express `app` (no server/port needed). They hit the same live seeded database as the dev server.

**Rules to keep them safe:**
- Never mutate seeded rows. Create dedicated fixtures (own leave types, balances, periods) via `helpers.ts` and delete them in `afterAll`.
- Test leave types are created `isActive: false` so annual-reset sweeps don't pick them up; the annual-reset test activates its type and uses far-future years (2098/2099), deleting all rows for those years afterwards.
- Vitest config sets `fileParallelism: false` — files share one DB; parallel files would race on balances/audit counts.

**Why:** No separate test database exists (air-gap demo, single DATABASE_URL); tests must be self-cleaning and sequential to stay deterministic.
