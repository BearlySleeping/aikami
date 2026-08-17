# Database — Local Postgres & the Server Data Plane

Everything about the **server-side** relational database: how to run Postgres
locally, and how the hub's catalog write model is structured, migrated, and
deployed.

> This is a contributor/operator document. It has nothing to do with player
> data. Gameplay state — campaigns, saves, chat history — lives in Turso
> (libSQL) **on the player's device** and never touches Postgres.

---

## What Postgres is for

The hub's server-side write model lives in `packages/backend/database/`
(Drizzle schema, generated migrations, pooled `pg` connection, catalog
repositories).

Postgres is the **write** model. The static catalog index is a **derived read
model** regenerated at publish time — nothing browses the catalog by querying
Postgres at request time.

Production runs on [Neon](https://neon.tech); local development runs a
Nix-pinned Postgres of the same major version so the two speak the same wire
protocol.

---

## Local Postgres (dev)

Aikami pins **PostgreSQL 18** in the Nix devShell and runs it as a herdr dev
service like any other. No Docker, no system Postgres, no sudo: the server
runs as your OS user, binds to `127.0.0.1:5433` only (port 5432 is left free
for your own system Postgres), and keeps all state in the gitignored
`.postgres/` directory.

```bash
bun herdr:start postgres   # or: bun postgres:start (background)
bun herdr:stop postgres    # or: bun postgres:stop
bun postgres:status        # server state + connection details
bun postgres:reset --yes   # delete all local data and re-initialise
bun postgres:psql          # interactive psql
```

Connection URL (database `aikami_dev` is created for you by `init`):

```
postgresql://localhost:5433/aikami_dev?sslmode=disable
```

Lifecycle script: `scripts/src/lib/postgres/lifecycle.ts`. If a previous run
left a stale `postmaster.pid`, `start` clears it automatically.

### Upgrading across a major version (17 → 18)

Postgres refuses to start on a data directory initialised by a different
major version. If you are coming from an older checkout:

```bash
bun postgres:stop
bun postgres:reset --yes   # ⚠️ destroys ALL local Postgres data
bun postgres:init
bun db:migrate             # re-apply migrations
```

---

## Connection strings

Two connection strings, both **server-side only**:

| Variable                   | Purpose                                                                     | Emulator                                                 | Production (Neon)                                   |
| -------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `NEON_DATABASE_URL`        | Runtime (pooled)                                                            | `postgresql://localhost:5433/aikami_dev?sslmode=disable` | Pooled endpoint (`-pooler` host), `sslmode=require` |
| `NEON_DATABASE_URL_DIRECT` | Migrations only (unpooled — DDL under PgBouncer transaction pooling breaks) | same as above (no pooler locally)                        | Direct endpoint                                     |

They live in `apps/frontend/hub/.env.{emulator,production}` and reach Cloud
Run as GSM secrets via the existing `buildSecretArgsFromEnvFile` path.

The connection is created **lazily on first query** — a dead database never
prevents the hub from booting. `GET /api/health/db` reports `unconfigured` /
`unreachable` instead.

---

## Migrations

```bash
bun run db:generate                        # drizzle-kit generate → timestamped SQL migration
bun run db:migrate                         # apply pending migrations to LOCAL postgres (idempotent)
bun run db:status                          # how many migrations are applied
bun run db:migrate --mode=production       # apply to Neon via NEON_DATABASE_URL_DIRECT
bun run deploy database --mode=production  # canonical deploy path: backup + apply
```

Migrations are **forward-only**, **generated** (never hand-edited),
**transactional**, and are **never auto-applied on server boot**.

Adding a table:

1. Edit `packages/backend/database/src/lib/schema.ts`
2. `bun run db:generate`
3. Commit the generated SQL
4. Apply locally (`bun run db:migrate`)
5. Apply through the deploy pipeline (`bun run deploy database --mode=production`)

---

## See also

- [Developer Workflow](dev-workflow.md) — daily commands
- [Data Layer Target Architecture](../architecture/data-layer-target-architecture.md)
