# Database — The Server Data Plane

Everything about the **server-side** relational database: what lives in it, how
it's migrated, and how to work with it locally.

> This is a contributor/operator document. It has nothing to do with player
> data. Gameplay state — campaigns, saves, chat history — lives in Turso
> (libSQL) **on the player's device** and never touches the server database.

---

## Three planes, one sentence each

| Plane | Store | Owns |
| --- | --- | --- |
| **Player device** | Turso (libSQL) | Campaigns, saves, chat history. Source of truth. Works fully offline. |
| **Server** | Cloudflare D1 | Identity (Better Auth), community packs, save-backup metadata. |
| **Blobs** | Cloudflare R2 | Catalog assets, save backups. |

If you're looking for where a campaign is stored, it's not here. See
`packages/frontend/repositories`.

---

## What D1 holds

The hub's server-side write model lives in `packages/backend/database/`:

| File | What |
| --- | --- |
| `src/lib/d1_schema.ts` | The Drizzle schema (**sqlite** dialect) — the source of truth |
| `drizzle.d1.config.ts` | Drizzle Kit config pointed at that schema |
| `drizzle/` | Generated migrations. Never hand-edited. |
| `src/lib/repositories/` | Query layer — nothing else touches the driver |

Tables:

- **`user`, `session`, `account`, `verification`** — Better Auth's identity tables (C-426 AC-1)
- **`packs`, `pack_versions`** — the community catalog write model, `packs.owner_account_id` → `user.id`
- **`account_backups`** — metadata for Turso saves backed up to R2 (C-426 AC-6/AC-7)

D1 is the **write** model. The public catalog index is a **derived read model**
regenerated at publish time — nothing browses the catalog by querying D1 at
request time (invariant I-7).

---

## How the app reaches D1

D1 is a **Worker binding**, not a connection string. `apps/frontend/hub/wrangler.jsonc`
declares it:

```jsonc
"d1_databases": [{ "binding": "DB", "database_name": "aikami-hub", "database_id": "..." }],
"r2_buckets":   [{ "binding": "SAVES_BUCKET", "bucket_name": "aikami-saves" }]
```

and the app reaches it through `platform.env.DB`, wrapped in Drizzle:

```ts
const db = drizzle(env.DB, { schema: d1 });
```

There is no `DATABASE_URL` to set, and no credential to leak. Server code must
import the database package only from `src/lib/server/` in the hub — the I-1
bundle guard enforces this.

---

## Local development

`wrangler dev` provides D1 and R2 from miniflare, persisted under `.wrangler/`.
No Cloudflare account and no network are involved.

```bash
bun run db:generate    # drizzle-kit generate → a timestamped SQL migration
bun run db:migrate     # apply pending migrations locally
bun run db:status      # how many migrations are applied
```

> 🔧 **Local D1 bindings:** `bun moon run hub:dev` (Vite) does **not** provide
> the `DB` / `SAVES_BUCKET` bindings. Use `bun moon run hub:dev-worker`
> (wrangler dev --local) when your work touches auth, the catalog, or save
> backups. See [dev-workflow.md](dev-workflow.md#hub-worker-wrangler-dev---local)
> for setup instructions.

---

## Migrations

Migrations are **forward-only**, **generated** (never hand-edited),
**transactional**, and **never auto-applied on server boot**.

Adding a table:

1. Edit `packages/backend/database/src/lib/d1_schema.ts`
2. `bun run db:generate`
3. Commit the generated SQL — it's reviewed like code
4. Apply locally and verify
5. Apply through the deploy pipeline (`bun run deploy database --mode=production`),
   which runs `wrangler d1 migrations apply`

---

## Removed: Neon Postgres (C-436)

The Neon PostgreSQL data plane was removed in **C-436**. The hub now uses
Cloudflare D1 exclusively. The Postgres schema (`pg` dialect), connection pool,
herdr `postgres` service, and `bun postgres:*` scripts have all been deleted.
`NEON_DATABASE_URL` is no longer a recognized environment variable.

---

## See also

- [Developer Workflow](dev-workflow.md) — daily commands
- [Data Layer Target Architecture](../architecture/data-layer-target-architecture.md)
- `docs/contracts/C-426-cloudflare-native-identity-and-hosting.md`
