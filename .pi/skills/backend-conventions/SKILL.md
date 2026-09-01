---
name: backend-conventions
description: >-
    🔴 LOAD BEFORE writing ANY Aikami server-plane code (apps/frontend/hub/src/lib/server,
    apps/backend/*, packages/backend/*) — Cloudflare D1 (Drizzle) + R2 via the
    hub's Elysia + TypeBox route handlers, Better Auth session verification,
    the apps/backend/worker always-on VM (Discord bot), and backend testing
    rules. Load aikami-conventions first for universal rules.
version: 2.0.0
tags: ["aikami", "backend", "cloudflare", "d1", "elysia", "drizzle", "testing"]
---

# Aikami Backend Conventions

**Prerequisite**: load `aikami-conventions` first (logger, imports, TS
strictness, monorepo boundaries, TypeBox schema-first types).

---

## Server Data Plane

The hub's server-side data plane runs on a **Cloudflare Worker** (SvelteKit
SSR adapter), backed by **D1** (SQLite, via Drizzle ORM) for structured data
and **R2** for blobs (save backups, uploaded objects). Identity is
**Better Auth**, backed by the same D1 database.

```
Request → verify session (Better Auth) → getDb(env) → Drizzle query → Response
```

**There is no controller/service/repository/`BaseDatabaseService` layer.**
Route handler functions in `apps/frontend/hub/src/lib/server/api/*.ts` call
Drizzle directly. Do not introduce a repository class that wraps a query and
restates its row type — the Drizzle schema already is that type. Keep query
logic as plain exported functions colocated with the route that uses them.

### Rules

1. **The Drizzle schema is the type source of truth.** Never hand-write a
   row type. Derive it: `type AccountBackupRow = typeof accountBackups.$inferSelect`
   (see `packages/backend/database/src/lib/schema.ts`'s `D1*Row` exports for
   the pattern). If a handler needs a row shape, import the table from
   `@aikami/backend-database` and infer from it — don't redeclare the fields.
2. **Never wrap a query in a repository that restates types.** A function
   that takes `db` and returns `db.select().from(table).where(...)` adds a
   layer without adding behavior. Call Drizzle directly in the handler, or in
   a plain helper function next to it if reused within the same route file.
3. **Obtain the db handle from one `getDb(env)` factory, called per
   request — never cached across requests.** Every handler that touches D1
   should build its Drizzle instance the same way
   (`drizzle(env.DB, { schema })`) rather than each route repeating its own
   inline `drizzle(...)` call with a different schema subset (the current
   route files each do this ad hoc — `save_backup.ts`, `better_auth.ts`; a
   shared `getDb(env)` consolidating the full schema is the target to
   converge on for new/touched handlers).
4. 🔴 **Never hold Worker env or bindings (`D1Database`, `R2Bucket`) in
   module scope.** A Cloudflare Worker isolate is shared across concurrent
   requests — a module-level binding captured from one request can leak into
   another's handling, or go stale. Pass `env` as a parameter (as the
   `handle*(request, env)` functions already do) or read it from SvelteKit
   `locals`, never from a package-level `let`.
   > **Known violation, not part of this rewrite**: `save_backup.ts`,
   > `storage.ts`, and `better_auth.ts` currently stash the per-request env
   > in a module-level `let _env` (`setXEnv`/`getXEnv`, populated by the
   > catch-all route). This is exactly the pattern rule 4 forbids and needs
   > a dedicated fix (threading `env`/`locals` through instead) — tracked
   > separately, not addressed here.
5. **Every handler verifies the session before touching D1 or R2.** Resolve
   the user via `getBetterAuth().api.getSession({ headers: request.headers })`
   and return a `401` (`{ error: 'unauthorized' }`) immediately if there is
   no session — before any query or R2 call. See `getSessionUserId()` in
   `save_backup.ts` / `storage.ts` for the reference shape. Scope every
   D1 row and R2 object key to the resolved account id (`WHERE accountId =`,
   `users/{accountId}/...` key prefixes) so one user can never read or write
   another's data.

### Reference shape

```typescript
// apps/frontend/hub/src/lib/server/api/example.ts
import { exampleTable } from '@aikami/backend-database';
import { eq } from 'drizzle-orm';
import { getBetterAuth } from './better_auth.ts';
import { getDb } from './db.ts'; // target: one shared per-request factory

type ExampleEnv = {
	// biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
	DB: import('@cloudflare/workers-types').D1Database;
};

export const handleExample = async (request: Request, env: ExampleEnv): Promise<Response> => {
	const auth = getBetterAuth();
	const session = auth && (await auth.api.getSession({ headers: request.headers }));
	if (!session?.user.id) {
		return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
	}

	const db = getDb(env);
	const rows = await db.select().from(exampleTable).where(eq(exampleTable.accountId, session.user.id));
	return new Response(JSON.stringify(rows), { status: 200 });
};
```

All routes are registered on a single shared `Elysia` app in
`apps/frontend/hub/src/lib/server/api/index.ts`, prefixed `/api`. Better
Auth is mounted at `/api/auth/*` via Elysia's `.mount()`.

---

## Schema & the Server-Only Package Boundary

The D1 schema (Drizzle `sqlite` dialect — Better Auth identity tables, catalog
`packs`/`pack_versions`, `account_backups`) lives in
`packages/backend/database` (`@aikami/backend-database`), imported as
`import { accountBackups } from '@aikami/backend-database'`.

🔴 **I-1**: `@aikami/backend-database` is **server-only**. Import it only
from `apps/frontend/hub/src/lib/server/**` or Node contexts (deploy
scripts). A client-bundle import must fail loudly — enforced by
`scripts/src/lib/ops/guard_data_plane.ts` (`bun run guard`).

Better Auth itself is wired in `packages/backend/auth/src/lib/better_auth.ts`
as a factory (`createBetterAuth(db, options)`) — the caller supplies the
Drizzle database instance, so the same factory works against the real D1
binding in production and an in-memory libsql database in tests.

Cross-boundary request/response validation uses TypeBox (`t` from `elysia`,
or schemas imported from `@aikami/schemas` when the shape is shared with
other projects — see `aikami-conventions` § Validation). Never hand-write a
Drizzle table definition outside `packages/backend/database`.

---

## `apps/backend/worker` — Always-On Background Host

Despite the name, this is **not** the hub's Cloudflare Worker. It's a
generic always-on host deployed to a single Compute Engine VM (see
`apps/backend/worker/README.md` and `scripts/src/lib/worker/deploy.ts`),
used for connections that must stay open (Discord Gateway) — a poor fit for
a pay-per-invocation platform. Its one HTTP surface is a plain Elysia app
(`/health` + the Discord Interactions Endpoint). New always-on background
jobs plug in the same way: declare required env keys, start them in
`apps/backend/worker/src/index.ts`.

`apps/backend/{image,text,voice}` are separate local AI microservices —
unrelated to the hub's data plane or the worker VM.

---

## Data Validation

All cross-boundary inputs are validated with TypeBox (see
`aikami-conventions` § Validation). Shapes shared across projects live in
`packages/shared/schemas/`; route-local request/response shapes may be
defined inline in the route file when nothing outside that route consumes
them. Never define a Drizzle table or a cross-project schema inside
`apps/**`.

Errors use `toAppError` from `@aikami/utils` (see `aikami-conventions`
§ Error Handling).

---

## Backend Testing

- Tests live alongside the code they cover (e.g.
  `apps/frontend/hub/src/lib/server/api/tests/`), using `bun:test`.
- Mock the D1 binding at the Worker-binding boundary, not the ORM: tests
  create an in-memory `@libsql/client` database (same SQLite engine D1 uses,
  with the generated D1 migration applied) and wrap it in a mock
  `D1Database` shape (`prepare().bind().all()/.first()/.run()`, `exec()`) —
  see `apps/frontend/hub/src/lib/server/api/tests/auth.test.ts` for the
  reference pattern. This exercises the real production path (handler →
  drizzle D1 driver → schema) without a real Cloudflare binding.
- Never call a real D1/R2 binding or external network service from a unit
  test.

## Related Skills

None currently — Functions/Firestore-era companion skills (`firestack`,
`firestore-collection`, `dataconnect`) were removed; there is no
Cloudflare-D1-specific companion skill yet.
