# Aikami Data Layer — Review & Recommendation

> Response to `database-architecture-inquiry.md`. Every claim below was
> verified against the code on `main` at 2026-08-12. Where I disagree with the
> inquiry doc, §11 says so explicitly.

---

## 0. TL;DR

1. **You have live, unauthenticated data exposure in production today** —
   not in Data Connect (which isn't deployed), but in `firestore.rules`:
   `personas/{personaId}: allow read: if true` lets anyone dump every persona
   in the product. Fix today, independent of any architecture work.
2. **Delete Firebase Data Connect.** It is excluded from prod, has one real
   consumer, and every friction you've hit with it is inherent to the product
   rather than a learning curve. It is the single biggest source of the
   duplication you're trying to eliminate.
3. **The local SQLite schema has no migration mechanism.** `CREATE TABLE IF
   NOT EXISTS` never adds a column to an existing user's database. The first
   time you add a column to a shipped table, every existing install breaks at
   runtime on the user's disk. This is a correctness bug, not a DX nit, and it
   outranks everything except the security holes.
4. **Do not build whole-DB libSQL sync.** Its granularity fights your tenancy
   model. Push a deliberate *projection* upward through the hub's API instead.
5. **The hub's content catalog belongs in Postgres behind the Elysia API**,
   with the immutable artifacts staying as static manifests + CDN.
6. **Redis: no.** Not now, maybe not ever, and definitely not in a
   self-hostable BYOK product.

---

## 1. Fix now — security

These are ordered by "how bad is it right now".

### 1.1 Firestore: every persona in the product is world-readable — LIVE

`apps/backend/firebase/src/rules/firestore.rules`:

```
match /personas/{personaId} {
  allow read: if true;
```

An `allow read` on a wildcard document path permits **list queries over the
collection**. Any anonymous caller can enumerate `personas` and page through
every persona every user has ever created. In an AI-companion product a
persona is the user's self-characterization — name, description, traits, an
avatar URL. This is the most sensitive shape of data in the app after chat
content.

The inquiry doc files this as ND-4, "a design question: accept public read or
add a visibility column". I disagree with the framing. Nothing in the product
requires a stranger to read your persona. The default is wrong, it is deployed,
and it should be `isDocumentOwner('uid') || isAdmin()` before you think about
anything else in this document. If public personas become a feature later, add
a `visibility` field then and gate on it — the way `npcs` already does two
blocks further down in the same file, which is proof you already know the
pattern.

### 1.2 Data Connect: an anonymous *write* primitive

The inquiry doc flags `ListPersonas @auth(level: PUBLIC)` as a read exposure.
It missed the worse one. In `connector/queries.gql`:

```graphql
mutation UpsertSaveSlot(
  $id: String!, $uid: String!, $slotNumber: Int!, ...
  $storageRef: String!
) @auth(level: PUBLIC) {
```

`PUBLIC` on a **mutation** means an unauthenticated caller can upsert a save
slot row for any uid, with an attacker-chosen `storageRef`. That is: silently
repoint a victim's save slot at a blob you control, or overwrite their slot
list. `ListSaveSlots` is `PUBLIC` too, so you can enumerate the targets first.

Six of the fourteen operations in that connector are `PUBLIC`. The only thing
standing between this and a real incident is `firestack.config.ts:21` excluding
Data Connect from staging and prod. Your mitigation is "the feature is turned
off." The day someone flips that flag to ship the hub, this ships with it.

If you keep Data Connect (see §2 — I don't think you should), no operation may
be `PUBLIC` except a genuinely public catalog read like `GetTracksByMood`.

### 1.3 Storage: cross-user asset overwrite

`storage.rules`:

```
match /npcs/{npcId}/{allPaths=**} {
  allow write: if isAuthenticated() && isValidImageType() && isValidFileSize();
}
```

Any logged-in user can overwrite any NPC's avatar — there is no owner check,
only a content-type check. Same shape under `match /public/`. That's a
defacement vector, and since `npcs/**` is `allow read: if true`, whatever gets
uploaded is served to everyone. Scope the write to the NPC's creator (you'll
need the uid in the path, e.g. `npcs/{uid}/{npcId}/**`, since Storage rules
can't join to Firestore cheaply).

---

## 2. The big call: delete Data Connect

This is the recommendation I feel most strongly about, so here is the full
argument rather than an assertion.

**The case against, from your own codebase:**

- It is excluded from staging and prod for cost. A datastore that isn't
  deployed isn't a datastore, it's a liability — it produces code paths that
  pass locally and fail in prod. Concretely: `personas/+page.server.ts` catches
  the failure and returns `{ personas: [] }`. In production that page renders
  an empty list and logs. The hub's only product feature is silently broken in
  the environment that matters, and the fallback hides it.
- **Auth is operation-level only.** No table-level policy, so every new query
  re-litigates authorization in a CEL string, and one `PUBLIC` typo is a data
  breach (§1.2 — this already happened, six times).
- **No client transactions** in `@firebase/data-connect@0.7.3`. Your
  one-active-persona invariant is therefore two sequential mutations with a
  documented "transient zero-active window", backstopped by a partial unique
  index that has to be **hand-applied** to the emulator's Postgres because
  there is no migration mechanism. That comment block in `queries.gql` is 12
  lines of prose explaining why you can't do a two-row update. Read it again as
  an outside observer: that's the tool telling you something.
- **You need a home-grown regex GraphQL parser**
  (`generate_dataconnect_schemas.ts`) to get TypeBox types out, and it drops
  relations.
- **The generated SDK is a browser SDK running in Bun SSR**, with
  `fetchPolicy: 'SERVER_ONLY'` threaded through to defeat a client cache that
  has no business existing server-side.
- Nine tables. One real consumer (hub personas), one dev-only view
  (`views/dev/save_load`), one incidental (`GetTracksByMood` in combat).

**The case for, honestly stated:** Data Connect's actual selling point is
letting a *client* talk to Postgres safely with a typed generated SDK and no
server. That is a real product and for a client-only app it's a good trade.

**Why it doesn't apply to you:** you already have a server. The hub is
SvelteKit on Cloud Run with Elysia mounted at `api/[...slugs]`. The moment you
have a trusted server process, DC's core value proposition evaporates and you
are left holding only its constraints. You are paying the full cost of the
"no server" architecture while running a server.

**What replaces it:** `pg` against a Postgres instance, called only from the
Elysia API, authed from the `__session` cookie you already mint. You have `pg`
8.23.0 in `apps/frontend/hub/package.json` already — it's how your own
verification scripts talk to the emulator's Postgres. Those scripts are the
prototype of the right architecture.

**On the Postgres instance itself:** Cloud SQL has no scale-to-zero and a
floor around $10–15/mo for the smallest instance, which is presumably why you
balked. Neon or Supabase have real free tiers and scale to zero; Neon in
particular is a good fit because you can point it at a plain `pg` client and
nothing about your code knows the difference. Turso also serves this role
(§6). Any of these is cheaper than Cloud SQL and none of them locks the
schema behind a GraphQL dialect.

---

## 3. Target architecture — three planes, one job each

| Plane | Store | Owns | Reached by |
|---|---|---|---|
| **Device** | Turso/libSQL local (native + WASM/OPFS) | Everything the player owns and plays: campaigns, saves, sessions, checkpoints, journal, chat turns, NPC state, asset install state | The client, directly. Never leaves the device except as an explicit projection or backup. |
| **Account & catalog** | One Postgres, server-owned | Content-pack/asset catalog, LPC/sprite/map/music metadata, ratings, install counts, moderation, user profile, save-slot *index* | **Only** the hub's Elysia API. No browser ever holds a DB credential. |
| **Blobs & identity** | Firebase Storage + Auth (+ FCM) | Save blobs, pack payloads, sprite/audio binaries, sign-in, push | Client via rules; server via Admin SDK |

Firestore's role shrinks to whatever survives §4. Data Connect's role is zero.

The property that makes this work: **each entity has exactly one home**, and
crossing planes is an explicit API call rather than an ambient sync. Your
current pain — Persona in four places, Chat in three — is entirely a symptom
of not having drawn this line.

---

## 4. The question nobody asked: does chat need to be realtime?

This is the highest-leverage fork in the whole review, and the inquiry doc
routes around it.

Right now every chat turn is written to **both** Firestore
(`npc_chat_firestore`) and local Turso (`conversation_storage`), in different
shapes, plus there's a third idle definition in `schema.gql`. The stated reason
Firestore survives is "realtime chat/messages/notifications."

So: realtime *between whom?*

If Aikami is a single-player, local-first, BYOK game where the player talks to
NPCs the model generates on their own device — then there is no second party
to be realtime with. Firestore is buying you per-document read costs, a
network round trip in the hot path of the thing your product does most, and a
whole schema family, in exchange for a capability nobody is using. The Turso
write already happened; it's the source of truth; delete the Firestore path.

If Aikami genuinely has multi-user surfaces — the `group_chat`, `chat_link`,
`connected_chats_service`, and `relationship` schemas suggest at least an
intent — then keep Firestore for **exactly those** collections and nothing
else, and let single-player NPC chat be Turso-only.

Either way, the answer changes the store map more than any other decision
here, and it's a product question only you can answer. Don't let it stay
implicit. My read of the file inventory is that the multi-user surfaces are
mostly aspirational scaffolding from an earlier "AI companion web app" phase,
and the game you're actually shipping is single-player — but I'd rather ask
than assume.

---

## 5. The sleeping bug: no local schema migrations

Verified: `local_database_factory.ts` runs `AIKAMI_SCHEMA_DDL` top to bottom on
every open. There is no `PRAGMA user_version`, no `schema_version` row in
`meta`, no `ALTER TABLE` anywhere in `packages/frontend/storage/src`.

`CREATE TABLE IF NOT EXISTS` on a table that already exists is a **no-op**. It
does not reconcile columns.

- Adding a new *table* works. That's the C-373 asset-registry case, and it's
  the case your test covers — `storage_adapter.test.ts:325` asserts three new
  tables appear, with a comment reading "databases upgrade in place (additive
  migration, no data loss)."
- Adding a *column* to an existing table silently does nothing on every
  existing install. The next query referencing it throws `no such column` — on
  the user's machine, against their only copy of their save data.

That test comment is the dangerous part: it reads like a general guarantee and
is only true for the narrow case it exercises. Someone will add
`sessions.mood_json` in six months, see green tests, and ship it.

**Fix:** a versioned migration list, applied in a transaction, keyed on
`PRAGMA user_version`. This is ~40 lines by hand:

```ts
const MIGRATIONS: readonly (readonly string[])[] = [
  [...],  // v1 — everything currently in AIKAMI_SCHEMA_DDL
  ['ALTER TABLE sessions ADD COLUMN mood_json TEXT'],  // v2
];
// read user_version, apply MIGRATIONS.slice(version), set user_version
```

Do it before the next schema change, not after. Note you also need to handle
the installs that already exist at "v0 but with the v1 tables" — the initial
migration must stay idempotent (`IF NOT EXISTS`) so an existing user lands on
v1 cleanly.

---

## 6. Sync: don't replicate the database, publish a projection

**Can the hub read the user's Turso?** No, and I'd push back on wanting it to.

libSQL sync is whole-database. To use it for per-user data you need one
database per user. Turso does support that — per-tenant DBs are literally
their pitch — but look at what it costs you:

- Provisioning and token minting per signup, plus a Firebase→Turso credential
  bridge that doesn't exist.
- Schema migrations fanned out across N databases (Turso's schema-parent
  feature exists for this; it's another moving part with its own failure
  modes).
- **Cross-user queries become impossible.** "Most-installed content packs",
  "trending campaigns", moderation, any leaderboard — those are the hub
  features you actually want, and they cannot be answered by N single-tenant
  databases. You'd end up adding the shared Postgres anyway, on top of the N
  databases.
- Whole-DB replication means the cloud holds *everything* on the device,
  including chat transcripts, which for a BYOK privacy-positioned product is a
  posture change you should make deliberately rather than as a side effect of
  a sync mechanism.

**Instead:** the client pushes a small, explicit projection to the hub API.
Save-slot index, campaign summary, active persona, pack install events — rows
you choose, through `POST /api/…`, authed by session cookie, idempotent and
resumable via a local outbox table. You control granularity, you can evolve
the wire format, you can audit what leaves the device, and it degrades
gracefully offline because the local DB was never waiting on it.

The blob path already works this way: ECS snapshots go to Firebase Storage
under `saves/{uid}/…` with owner-only rules. Keep that; just move the *index*
from a DC table to your Postgres.

**And consider not building sync at all in v1.** "Don't lose my game" is
satisfied by explicit backup/restore to Storage, which you have. True
multi-device merge is a distributed-systems project with conflict semantics
you'd have to invent for ECS snapshots. C-203 exists as a document, not as a
user request. Ship the projection, defer the merge.

---

## 7. The hub's real features (packs, LPC, sprites, maps, music)

Split by mutability — this is the part the inquiry doc leaves open and it has
a clean answer:

- **Immutable artifacts** (the actual sprite sheets, audio, map JSON, pack
  payloads) → Firebase Storage / CDN, addressed by content hash. You already
  have `asset_hashes.json` and a `manifest.json`. Content-addressed means
  caching is trivially correct and the client's `install_state` table already
  models it.
- **The catalog** (what packs exist, versions, dependencies, licenses,
  attribution, tags, preview URLs) → a signed static JSON index for the happy
  path, generated at publish time. Cheapest possible read, works offline,
  no DB in the request path, and `pack_index.ts` already describes the shape.
- **Mutable social metadata** (ratings, install counts, comments, moderation
  flags, user-submitted packs pending review) → Postgres behind the Elysia
  API. This is the part that genuinely needs a database, and it's small.

The nice property: a self-hoster can point at a different static index and
skip the Postgres entirely, which keeps the BYOK story intact.

---

## 8. Schema single-source and codegen

**First, a correction to the inquiry doc.** It claims Persona exists in four
places including a hand-written copy in `@aikami/types`. It doesn't —
`packages/shared/types/src/lib/firestore/persona.ts` is a one-line re-export of
`PersonaData` from `@aikami/schemas`, and most siblings in that directory
follow the same pattern. The types package is a facade, not a duplicate. Real
duplication is three-way (TypeBox / `schema.gql` / generated row), and it drops
to *zero* the moment DC goes away, because the generated row schemas and the
`persona_mapper.ts` RFC-3339↔epoch bridge exist solely to serve it.

**For the SQL side, use Drizzle**, not another home-grown DSL. Specifically:

- One TS schema definition per table → Drizzle generates DDL *and* types *and*
  timestamped migration files, and `drizzle-kit` diffs them for you. That's
  exactly the three-output pipeline you sketched in Q6, already built.
- It targets both SQLite/libSQL and Postgres from the same authoring style, so
  the device plane and the server plane share idiom without sharing a schema
  (they shouldn't share a schema — they model different things).
- It's a query builder, not an ORM — no runtime magic, no active-record, works
  fine with your existing `LocalDatabaseInterface` if you'd rather keep the
  adapter and use Drizzle purely for schema + migration generation.

Keep TypeBox as the validation layer at the API boundary; derive DB row types
from Drizzle. Don't try to make one definition serve both — validation schemas
and storage schemas legitimately diverge, and forcing them together is how you
end up with `Type.Unsafe<any>` escape hatches like the ones already in
`persona.ts`.

**On the `database/{firestore,turso,...}` folder restructure (Q5):** fine, do
it, but it's cosmetic. Deleting a store removes more confusion than any
directory layout adds clarity. Do the restructure *after* §2, when you know
what's left to organize.

**ND-1..ND-6:** if DC goes, ND-2, ND-3, ND-5 and ND-6 evaporate with the schema
that raised them. ND-4 is a security fix, not a decision (§1.1). ND-1 is real
and independent: you have two unrelated things called "notification"
(in-app messages vs. `ctaClicked`/`videoViewed` marketing analytics). Those are
different domains — rename the analytics one to `events` and the conflict
disappears.

---

## 9. Redis — no

Nothing needs it today. Rate limiting on Cloud Run can be per-instance
in-memory (imperfect, adequate) or a Postgres counter (exact, cheap at your
volume). Catalog caching is solved by the static index in §7. Sessions are
already stateless JWT-in-cookie.

More importantly: every piece of required infrastructure is a tax on
self-hosters, and self-hosting is a stated product value. Adding Redis to the
minimum deployment for rate limiting you don't yet need is a bad trade.
Revisit when you have a genuine job queue (async pack indexing, AI batch
generation) — and even then look at Postgres-backed queues first, because
"one database" is worth a lot.

---

## 10. Sequenced plan

**Now (hours, ships independently of everything else)**
1. `personas` rule → owner-only. Deploy.
2. Scope `storage.rules` NPC/public writes to the owner.
3. Remove every `@auth(level: PUBLIC)` from mutations in `queries.gql`, or
   delete the connector outright if you commit to §2 immediately.

**Next (the unblocking decision)**
4. Answer §4: is chat multi-user? Write the answer down in
   `docs/architecture/`.
5. Add `PRAGMA user_version` migrations to the local DB (§5). Before the next
   schema change.

**Then (the refactor)**
6. Stand up Postgres (Neon/Supabase free tier) + a `pg` data layer inside the
   hub's Elysia API. Move personas there behind `GET /api/personas`, authed by
   session cookie. Delete the frontend SDK import from `+page.server.ts`.
7. Delete `dataconnect/`, `packages/frontend/dataconnect`,
   `generated-dataconnect`, `persona_mapper.ts`,
   `firebase_data_connect_service.ts`, `firebase_sql_connect_sync.ts` (already
   stale — it references a `string_registry` DC table that doesn't exist), and
   the DC generation tasks in `moon.yml`.
8. Per §4: either delete the Firestore chat path or delete the Turso one. Not
   both, and not neither.
9. Build the content catalog per §7. This is the hub feature you actually
   want, and steps 6–8 are what clear the runway for it.

**Later**
10. Drizzle migration for the local schema, once §5 has bought you safety and
    you're changing it often enough to want the tooling.
11. Projection sync (§6), if and only if a user asks for multi-device.

---

## 11. Where I disagree with the inquiry doc

- **ND-4 is not an open design question.** It's a live data leak (§1.1).
- **It missed the `PUBLIC` mutations** (§1.2), which are worse than the
  `PUBLIC` reads it did flag.
- **The `@aikami/types` "fourth copy" is wrong** — it's a re-export facade
  (§8). Duplication is three-way, not four-way.
- **Q6 is framed as DX. It's a correctness bug** (§5) and belongs near the top
  of the priority list, not the bottom.
- **Q2 is framed as "can the hub read the user's Turso?"** The useful question
  is "what should ever leave the device, and who publishes it?" (§6). The
  original framing leads toward whole-DB sync, which is the wrong mechanism.
- **It treats Data Connect as one option among several.** Given a server
  already exists, I don't think it's a live option (§2).
- **It never asks whether realtime chat is a real requirement** (§4), which is
  the decision that most changes the answer.

Everything else in the inquiry doc checked out against the code — the
inventory, the duplication map, the emulator-only status, the unwired sync,
the SSR smell, and the stale-code findings are all accurate.
