# LexDraft API — integration test harness

The default `pnpm --filter @lexdraft/api test` suite runs the **unit** tests
against the in-memory fallback (`DATABASE_URL=''`). This is fast and great
for CI fan-out, but it leaves two important things unvalidated:

1. The SQL migrations under `apps/api/migrations/` are never applied against
   a live Postgres.
2. The SQL branches inside service modules (`if (sql) { ... }`) are never
   exercised. A typo, a renamed column, or a broken JOIN won't surface until
   a real customer hits prod.

The **integration suite** in this directory closes those gaps. It runs the
same Vitest framework but against a real Postgres pointed at by
`TEST_DATABASE_URL`.

---

## 1. Spin up Postgres locally

The fastest path is Docker. One-liner that maps Postgres to a non-default
host port so it doesn't collide with any local dev DB you have on `5432`:

```bash
docker run -d --name lexdraft-test-pg \
  -p 5433:5432 \
  -e POSTGRES_PASSWORD=postgres \
  postgres:16-alpine
```

Stop and discard between branches:

```bash
docker rm -f lexdraft-test-pg
```

The default DB name is `postgres`; the integration harness creates an
ephemeral schema (`test_<random6>`) per test file, so you don't need a
separate database.

---

## 2. Run the suite

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres \
  pnpm --filter @lexdraft/api test:integration
```

If `TEST_DATABASE_URL` is unset every test fails on its first hook with a
clear error message — the suite never silently falls back to in-memory mode.

The regular unit suite is unaffected:

```bash
pnpm --filter @lexdraft/api test            # unit — fast, in-memory
pnpm --filter @lexdraft/api test:integration # integration — Postgres
```

---

## 3. Isolation strategy: schema-per-test-run

Why not a database-per-run or a `truncate` between tests?

- **DB-per-run** would require `CREATE DATABASE` privileges that aren't
  guaranteed in cloud Postgres (e.g. RDS, Cloud SQL). Schemas need only the
  schema-owner role.
- **`truncate` between tests** ties every test file to a single shared
  schema, which means parallel runs (CI matrix, dev `--shard`) trip over the
  same `cases` / `users` rows.

The harness instead:

1. Generates a random schema name `test_<6 hex chars>` per Vitest worker.
2. Applies every migration file under `apps/api/migrations/` to that schema,
   driving routing via `set search_path to "test_<hex>", public`.
3. Rewrites `process.env.DATABASE_URL` to include the same
   `?options=-csearch_path=...` query so the API's lazy `db()` client lands
   on the same schema once a service is imported.
4. Drops the schema CASCADE in `afterAll`.

This is implemented in `src/__tests__/integration-db.ts` and orchestrated
from `src/__tests__/integration-setup.ts` (Vitest `setupFiles`).

---

## 4. Adding a new integration test

Convention: place the file alongside the unit test using the
`*.integration.test.ts` suffix.

```
src/services/__tests__/foo.test.ts             # unit
src/services/__tests__/foo.integration.test.ts # integration
```

Use this template:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { fooService } from '../foo.service';
import {
  seedFirm,
  seedUser,
  type SeededFirm,
  type SeededUser,
} from '../../__tests__/integration-fixtures';

let firm: SeededFirm;
let user: SeededUser;

beforeAll(async () => {
  firm = await seedFirm('Foo Firm');
  user = await seedUser(firm.id, { email: 'foo@integration.test' });
});

describe('fooService — real Postgres', () => {
  it('does the thing', async () => {
    const result = await fooService.doTheThing(user.id, firm.id);
    expect(result).toBeTruthy();
  });
});
```

Conventions:

- **Always seed your own firm + user in `beforeAll`.** Don't reuse fixtures
  across files — the schema is fresh per file (via setup hook).
- **Never set or reset `DATABASE_URL` from inside a test.** The setup file
  owns that knob.
- **Need raw SQL?** Call `getIntegrationSql()` from `integration-db.ts`.
- **Need a second firm to prove cross-tenant safety?** Call `seedFirm` again
  and assert the row count or visibility from each firm's perspective.
- **Need MFA codes?** Use `authenticator.generate(secret)` from `otplib` —
  see `mfa.integration.test.ts`.

---

## 5. CI

The unit suite runs first; the integration suite runs after on a Postgres
service container. See `.github/workflows/ci.yml` (owned by the
production-deploy agent).
