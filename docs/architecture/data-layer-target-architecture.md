# Data Layer — Target Architecture (ADR)

> **This is a reference document, not a contract. Do not "implement" this file.**
> Contracts C-383 … C-387 execute the data-layer teardown; C-394 … C-399 (§5.1)
> execute the community hub. When a contract and this document disagree, this
> document wins — raise an amendment on the contract.

**Decided:** 2026-08-12
**Last amended:** 2026-08-21 (see §6 — D-6, D-12, D-13 revised; D-17 added; I-10 added; §4.2 added)
**Supersedes:** `apps/backend/firebase/dataconnect/schema/firestore-vs-dataconnect.md`
**Rationale & alternatives considered:** `docs/research/database-architecture-recommendation.md`

---

## 1. The decisions

| # | Decision | Consequence |
|---|---|---|
| **D-1** | **Firebase Data Connect is removed entirely.** | Delete `dataconnect/`, `packages/frontend/dataconnect`, `generated-dataconnect`, the DC codegen tasks, and every DC consumer. |
| **D-2** | **Firebase stops being a database vendor.** It provides Auth, Storage, FCM, App Check — nothing else. | Firestore is removed as a datastore (C-386). |
| **D-3** | **Local SQLite (Turso/libSQL) is the source of truth for all player-owned data.** | Campaigns, saves, sessions, checkpoints, journal, chat, personas, NPC state, asset install state. Never leaves the device except as an explicit, deliberate projection. |
| **D-4** | **Chat is not realtime.** | Single-player NPC chat is local-only. The Firestore chat/message path is deleted, not kept "just in case". |
| **D-5** | **The hub is public/community only.** It never reads user-owned data. | No personas in the hub. No user Turso in the hub. No per-user sync. |
| **D-6** | ~~One Cloud SQL for PostgreSQL instance, `europe-west4`~~ → ~~One Neon PostgreSQL 18 project, `aws-eu-west-2` (London)~~ → **Cloudflare D1 (SQLite), reached only through the hub's Elysia API, running as a Cloudflare Worker (D-17).** *(amended 2026-08-15 — A-1; superseded 2026-08-21 — A-12)* | No browser ever holds a database credential. All authorization is server-side middleware. D1 is a native Workers binding (`env.DB`) — no raw TCP socket, no Hyperdrive proxy, no cross-cloud hop. See §4.2 for why this supersedes A-1 rather than amending it. |
| **D-7** | ~~Postgres is provisioned when the first mutable community feature ships~~ → **The mutable-state database is provisioned now**, because the first mutable community feature (user-submitted mods) is committed scope. *(amended 2026-08-15 — A-2; database vendor superseded 2026-08-21 — A-12)* | The immutable catalog still ships as a static index (D-14); the database owns only mutable state — accounts/identity, packs, pack_versions, save backups. |
| **D-8** | **Local development uses real PostgreSQL** (Nix-provided), not pglite, not an emulator. | Local ≡ production. Removes the class of bug hit in C-374. |
| **D-9** | **Drizzle owns SQL schema and migrations** for both the local SQLite plane and the server Postgres plane. They are separate schemas that share idiom, not definitions. | No hand-written DDL string arrays. No home-grown codegen. |
| **D-10** | **Staging is on hold** until there is a working app and a user base. | Production-only spend. `firestack.config.ts` mode handling must not break. |
| **D-11** | **No runtime Redis.** | Upstash stays in the deploy pipeline (`scripts/src/lib/deploy/cache.ts`) only. |
| **D-12** | ~~Firebase Auth is kept. No migration to Supabase Auth or any alternative.~~ → **Better Auth (D1-backed, Google OAuth) replaces Firebase Auth** for both the hub and the client. *(superseded 2026-08-21 — A-13)* | Session cookies and custom claims are reimplemented on Better Auth's session model. App Check is UNAFFECTED — it is orthogonal to which auth provider issues sessions (D-2's App Check line stands). Storage rules are moot once D-13 moves per-user blobs to R2. Rationale for reversing D-12 outright rather than amending: see §4.2. |
| **D-13** | **Cloudflare R2 is the origin for all catalog asset bytes.** ~~Firebase Storage keeps per-user save blobs.~~ → **Per-user save blobs (Turso backup snapshots) also move to R2**, authorized by Better Auth-minted signed URLs. *(added 2026-08-15 — A-3; costed A-10; per-user blob clause superseded 2026-08-21 — A-14)* | Egress is free at any volume, which no GCP or AWS object store matches — see §4.1 for the verified comparison. The original split existed because **R2 has no identity model of its own** — that gap is what D-12's Better Auth migration closes (the hub now mints a short-lived signed URL per authenticated request, the same shape Firebase Storage security rules provided). The `'r2'` backend already exists in `asset_sources` (`migrations.ts:201`). |
| **D-14** | **The catalog is a content-addressed static index on R2; Postgres holds only mutable state.** *(added 2026-08-15 — A-4)* | Browsing packs/LPC/maps/music/tilesets never touches Postgres. Ratings, install counts, submissions, ownership and moderation do. A self-hoster can point at a different index and run with no Postgres at all. |
| **D-15** | **The hub is publicly readable without authentication.** Sign-in is required only to submit, rate, or manage owned content. *(added 2026-08-15 — A-5)* | Reverses the current route layout, where `+page.server.ts` redirects every anonymous visitor to `/login`. Follows from D-5 — a community catalog nobody can read without an account is not a community catalog. |
| **D-16** | **The `AiProviderGateway` `service` mode is a thin metered proxy over Anthropic / OpenAI / Gemini — no GCP-hosted GPU inference.** *(added 2026-08-17 — A-11)* | Cloud Run GPU (L4) inference is rejected: ~$0.71/hr billed while warm, 20–30 s cold start that lands in the player's first dialogue turn, and quality capped by what fits on one L4. Self-hosted inference only wins at sustained high utilization, which a pre-revenue project does not have. The `service` adapter interface already exists (C-320); the swap is one layer (Directive #10). Revisit only at sustained near-continuous GPU utilization or a single-hosted-model quality gap that becomes product-limiting. |
| **D-17** | **The hub moves from Cloud Run (fronted by Firebase Hosting) to a Cloudflare Worker** — SSR via `@sveltejs/adapter-cloudflare`, same `hub.bearlysleeping.com` custom domain, using the Worker deploy pipeline `client`/`site`/`docs` already use (`scripts/src/lib/deploy/cloudflare.ts`). *(added 2026-08-21 — A-15)* | This is the change that forces D-6: a plain Worker cannot open the raw `node:net` socket `pg` needs to reach Neon (see the NOTE already recorded in `cloudflare.ts` anticipating exactly this). D1 is a binding, not a socket, so it needs no Hyperdrive detour. Firebase Hosting's rewrite-to-Cloud-Run config for the hub site is retired; `apps/frontend/hub/scripts/deploy.ts` (the Firebase Hosting deploy script) is deleted. |

## 2. The three planes

```
┌─ DEVICE ────────────────────────────────────────────────────┐
│ Turso / libSQL  (Tauri native + WASM/OPFS)                  │
│ SOURCE OF TRUTH for everything the player owns              │
│ campaigns · saves · sessions · checkpoints · journal        │
│ chat · personas · npc state · asset install state           │
│ Reached by: the client, directly. Never by the hub.         │
└─────────────────────────────────────────────────────────────┘
┌─ CATALOG (immutable) ───────────────────────────────────────┐
│ Content-addressed static index + asset bytes on R2 + CDN    │
│ content packs · lpc · sprites · maps · tilesets · music     │
│ Reached by: anyone, anonymously, straight from the CDN.     │
│ No credential, no Postgres, no request path through the hub.│
└─────────────────────────────────────────────────────────────┘
┌─ ACCOUNT & MUTABLE METADATA ────────────────────────────────┐
│ Cloudflare D1 (SQLite, Worker binding — D-17)                │
│ Better Auth user/session/account/verification (D-12)         │
│ ratings · install counts · submissions · ownership           │
│ moderation queue · publish history · save-backup metadata    │
│ Reached by: the hub's Elysia API ONLY. Never a browser.      │
└─────────────────────────────────────────────────────────────┘
┌─ IDENTITY & PRIVATE BLOBS ──────────────────────────────────┐
│ Better Auth (Google OAuth) · Cloudflare R2 (I-10) · FCM ·    │
│ App Check                                                    │
│ sign-in · per-user Turso save-backup blobs                   │
│ Reached by: client + hub via Better Auth session; R2 objects │
│ only via hub-minted signed URLs (I-10).                      │
│ NOT catalog assets — those are D-13's R2 origin, public.     │
└─────────────────────────────────────────────────────────────┘
```

*(Diagram updated 2026-08-21 — A-12/A-13/A-14. Firebase's remaining role after
this migration is FCM and App Check only — see D-2 and §5.3.)*

## 3. Invariants

Any change violating one of these is a bug, regardless of what a contract says.

- **I-1** — No browser, Tauri client, or SSR load function ever holds a Postgres
  credential or opens a direct database connection.
- **I-2** — No Firebase security rule grants a read to an unauthenticated
  caller on user-owned data. Public read is allowed only for genuinely public
  catalog artifacts (sprites, audio, packs, releases).
- **I-3** — The hub never reads, writes, or proxies player-owned data.
- **I-4** — The local SQLite schema is only ever changed through a numbered
  migration. `CREATE TABLE IF NOT EXISTS` is never used to alter an existing
  table.
- **I-5** — Every entity has exactly one home. Dual-writing the same entity to
  two stores is prohibited.
- **I-6** — Every cross-plane transfer is an explicit API call, never an
  ambient sync.
- **I-7** — No asset bytes ever pass through Postgres or through a hub request
  handler. The catalog serves URLs; the CDN serves bytes. *(added A-6)*
- **I-8** — No Postgres query sits in the server-render path of a page that can
  be rendered from the static index. Mutable metadata hydrates after first
  paint. Neon Free scale-to-zero (5 min, not disableable) makes a cold query a
  visible stall, so this is a correctness rule for perceived latency, not a
  micro-optimisation. *(added A-6)*
- **I-9** — ~~Nothing may depend on a Neon-proprietary surface: not Neon Auth,
  not the Neon Data API, not `@neondatabase/serverless`, not branching as a
  runtime mechanism. Plain `pg` over the pooled endpoint, plus Drizzle. This
  invariant is the entire reason "start on Neon, move to Cloud SQL later" is a
  connection-string change rather than a rewrite.~~ *(added A-6; MOOT 2026-08-21 — A-12: Neon is gone, so there is no Neon-proprietary surface left to avoid. Recorded rather than deleted so a future reader knows the portability concern was resolved by removal, not forgotten.)*
- **I-10** — No R2 object under a per-user prefix (`saves/{accountId}/…`) is
  ever public or content-addressed by a guessable key. Every read and write
  goes through a Better Auth session check on the hub, which mints a
  short-lived signed URL scoped to that one object. This is the R2 analogue
  of the Firebase Storage security rule D-13 originally relied on for
  `saves/{uid}/…`. *(added 2026-08-21 — A-14)*
- **I-11** — `@aikami/schemas` has no CLI, no generator, no wrangler
  dependency. No reference to `wrangler`, `drizzle-kit`, or `node:child_process`
  exists anywhere in that package's source or its `package.json` dependencies.
  This keeps schemas a pure declaration library, never an execution or
  generation host. *(added 2026-09-02 — C-454)*

## 4. Explicitly rejected

Recorded so they are not re-proposed.

| Rejected | Why |
|---|---|
| Firebase Data Connect | Operation-level auth only, no client transactions, hand-applied migrations, browser SDK in SSR, home-grown schema parser, excluded from prod. Costs the same Cloud SQL money as going direct. |
| Supabase (DB, Auth, or Functions) | Edge Functions' timeouts are wrong for LLM streaming. Auth migration would break Storage rules, FCM and App Check for zero gain (D-12). **Note (A-1):** the original rejection also cited cross-cloud latency — that argument no longer distinguishes Supabase from the chosen option, since Neon is cross-cloud too. What still separates them is lock-in: Supabase's value is its Auth/RLS/PostgREST stack, which is exactly what D-12 and I-9 forbid adopting. Neon is used as bare Postgres and stays portable. |
| Cloud SQL for PostgreSQL, at this stage | No scale-to-zero and a ~$10–15/mo floor for a pre-revenue project with no users. It remains the **destination** if scale or in-region latency ever justifies it — I-9 keeps that move a connection-string change plus `pg_dump`. Revisit when either the Neon Free ceiling (0.5 GB storage, 100 CU-hours, 5 GB egress) is genuinely approached, or a p95 query in the render path is measurably hurting. |
| whole-DB libSQL sync to Turso cloud | Granularity is per-database; per-user tenancy would need N databases, which makes the cross-user catalog queries the hub exists for impossible. Also replicates chat transcripts to the cloud, changing the BYOK privacy posture by accident. |
| Firestore for the community catalog | The catalog is relational (packs↔assets↔tags↔ratings). Adding a Firestore domain while removing Firestore is self-defeating. |
| AlloyDB / Spanner | Orders of magnitude more cost and complexity than the workload. |
| Self-hosted Postgres on always-free `e2-micro` | Saves ~$10/mo in exchange for owning backups, patching and uptime with no HA. Wrong trade for a solo maintainer. |
| Runtime Redis | Every required dependency taxes self-hosters. Nothing needs it yet. |

### 4.1 R2 vs Firebase Storage — the costed comparison behind D-13

Verified 2026-08-15 against Cloudflare's R2 pricing page and
`firebase.google.com/pricing`.

| | Cloudflare R2 | Firebase Storage / GCS `europe-west4` |
|---|---|---|
| Storage included | 10 GB/mo | 5 GB-months |
| Storage overage | $0.015/GB-mo | ~$0.020–0.022/GB-mo |
| Class A (writes/lists) | 1M/mo free, then $4.50/M | $5.00/M |
| Class B (reads) | 10M/mo free, then $0.36/M | $0.40/M |
| **Egress to internet** | **$0, at any volume** | **~$0.12/GB** |
| CDN caching | automatic via custom domain | none by default — `firebasestorage.googleapis.com/v0/b/…` is an origin read per download |
| Per-user authorization | none (signed URLs only) | Firebase Auth security rules |

R2 is modestly cheaper on storage and operations (~25% and ~10%). That is not
the argument. **Egress is the argument**, and the gap is not a percentage:

> 🔴 **The `*.firebasestorage.app` free tier does not apply outside the US.**
> Firebase's no-cost allowances for modern buckets (5 GB stored, 100 GB/mo
> downloaded, 50K download ops/mo) are documented as available **only in
> `us-central1`, `us-west1`, and `us-east1`**. A bucket colocated with the rest
> of this project's `europe-west4` infrastructure therefore falls through to
> raw Cloud Storage rates from the first byte. Confirm the actual location of
> `aikami-production.firebasestorage.app` in the console — if it is European,
> asset egress is already billable today.

Worked example on the current 93 MB library, per 1,000 users who download it in
full (93 GB/month):

| Users/month | R2 | Firebase Storage (EU, no free tier) |
|---|---|---|
| 1,000 | $0 | ~$11 |
| 10,000 | $0 | ~$112 |
| 100,000 | $0 | ~$1,120 |

Since C-397 exists precisely to make every player download assets on demand,
and C-398 lets the library grow without bound, egress is the cost that scales
with success. Free egress is worth more than every other line combined.

**What Firebase Storage keeps, and why the split is not hedging:** R2 has no
concept of a signed-in user. Per-user save blobs under `saves/{uid}/…` are
authorized by Firebase Auth security rules today, and reproducing that on R2
would mean the hub minting signed URLs for every read — a request path, a
credential, and a failure mode the current design does not have. Public catalog
bytes need no identity at all, which is exactly why they can leave.

**Costs R2 introduces:** a second vendor account and credential set, a custom
domain, and no local emulator equivalent. The last one is a real friction
point — the obvious answer (MinIO) is a container, which collides with C-387's
"No Docker" directive. C-395 must decide whether local development points at
the real bucket, a separate dev bucket, or the filesystem.

### 4.2 Why D-6, D-12 and D-13 are superseded outright, not amended *(added 2026-08-21 — A-12/A-13/A-14)*

A-1 through A-11 all amended decisions in place — the underlying trade-off
stayed the same and only a parameter changed (region, timing, a cost table).
This one is different: **D-17 (hub hosting moves to a Cloudflare Worker) changes
which trade-offs are even available**, so three prior decisions are reversed
rather than tuned.

- **D-6 (Neon → D1).** D-6/A-1's entire argument was "no Neon GCP region, so
  cross-cloud from Cloud Run is unavoidable — I-9 keeps the eventual move
  cheap." That argument presumes the compute side stays on a platform that can
  open a raw `pg` socket. Once the hub is a Worker, it can't — `pg` needs
  `node:net`, and a plain Worker has no TCP. The options at that point are (a)
  add a Hyperdrive binding in front of Neon, keeping Postgres but adding a proxy
  hop and a second piece of Cloudflare-side config, or (b) use D1, which is a
  binding (`env.DB`), not a socket, with no proxy needed. (b) removes an entire
  moving part that (a) would keep paying for indefinitely. I-9 (stay
  Neon-portable) becomes moot rather than violated — there is no Neon left to
  be locked into.
- **D-12 (Firebase Auth → Better Auth).** D-12 was correct in 2026-08-12: no
  other part of the stack needed Firebase Auth to move, so migrating it was
  pure risk for zero gain. That calculus changes once D-13's per-user save
  blobs move to R2 (next bullet) — R2 has no security-rules concept, so
  *something* has to mint per-request authorization for `saves/{accountId}/…`.
  Better Auth already has to exist to satisfy D-6/D-17 running natively on D1
  without a second identity system bolted on top; reusing it for the R2
  signed-URL check is one authorization surface instead of two live ones
  (Firebase Auth sessions serving the R2 path, Better Auth serving the D1
  path). App Check and FCM are untouched — D-12 never depended on them, only
  on "Auth" specifically.
- **D-13 per-user blobs (Firebase Storage → R2).** The original split (catalog
  bytes on R2, save blobs on Firebase Storage) existed *solely* because R2 had
  no identity model to authorize `saves/{uid}/…` reads. D-12's supersession
  removes that reason: Better Auth sessions, verified hub-side, can mint the
  same short-lived signed URL either object store would need. Keeping save
  blobs on Firebase Storage after Auth has already moved away would mean
  running Firebase Storage security rules against a Better Auth session they
  were never designed to read — a worse position than either "both on
  Firebase" or "both on Cloudflare." I-10 (added alongside) is the new
  invariant that replaces the security-rule guarantee.

**What does NOT change:** D-2 (Firebase still provides FCM and App Check — this
migration touches Auth and per-user blob storage only, not push notifications
or bot protection), D-3/D-5 (device-plane Turso remains the source of truth;
the hub still never reads player-owned data directly — it only stores an
opaque backup blob a player explicitly chose to upload), D-14/D-15 (the public,
unauthenticated catalog browse path is unaffected — D1 replaces Postgres as the
mutable-metadata store but the read-path shape is identical), I-1 through I-8
(no browser holds a database credential, no asset bytes through the database, no
database query in a statically-renderable render path — all still hold, now
against D1 instead of Postgres).

See C-426 for the executing contract and its own Migration & Rollback section
for the cutover sequence (ADR amendment lands first, then infrastructure, then
traffic cutover, with the prior stack left intact until each phase's AC is
verified).

## 5. Contract sequence

Each is independently mergeable and leaves the repo consistent if the next
never runs.

| Contract | Scope | Depends on | Ready? |
|---|---|---|---|
| **C-383** | Data-exposure hardening (rules + `PUBLIC` operations) | — | ✅ executable |
| **C-384** | Local SQLite migration framework (`user_version`) | — | ✅ executable |
| **C-385** | Data Connect removal + rehome its 3 consumers | C-383 | ✅ executable |
| **C-387** | Local PostgreSQL dev environment | C-385 | ✅ executable — land it immediately before catalog work |
| **C-386** | Firestore removal — client to local-first | C-384, C-385 | 🔴 **design needed** — 5 open questions |

C-383 and C-384 are independent of each other and of everything else; they can
run in parallel or in either order.

### 5.1 Community hub sequence *(added 2026-08-15 — A-7)*

The catalog is now specified, so the follow-on sequence exists. Each contract
is independently mergeable and leaves the repo consistent if the next never
runs.

| Contract | Scope | Depends on |
|---|---|---|
| **C-394** | Server data plane — Neon project, `pg` + Drizzle, catalog schema, migrations, Elysia repository layer. No UI. | C-387 |
| **C-395** | R2 asset origin + content-addressed publish pipeline. Moves the 93 MB of `game-data` off the client's `static/`. Client still bundles; nothing breaks. | — |
| **C-396** | Hub public shell + catalog browse SSR. Route restructure for D-15, browse/detail pages fed by the static index. | C-395 |
| **C-397** | Client asset migration — bundled → on-demand via `asset_sources` priority. | C-395 |
| **C-398** | Member submissions — signed upload, validation, ownership, moderation queue. | C-394, C-396 |
| **C-399** | Social metadata — ratings, install counts, moderation actions. | C-394, C-398 |

C-394 and C-395 are independent and can run in parallel — one is the mutable
plane, the other the immutable plane, and they share no data model.

### 5.2 What a "mod" is *(added 2026-08-15 — A-8)*

Recorded because it was an open question and it bounds C-398 sharply.

**A mod is a content pack plus its assets. It contains no executable code.**
The format already exists: `ContentPackManifest`
(`packages/shared/schemas/src/lib/game/content_pack.ts`) declares maps, NPCs,
items, dialogues, quests, encounters, factions and onboarding as data, and
every asset already carries a `pack_id` in the registry
(`migrations.ts:187`). Publishing a mod is therefore: validate a manifest
against an existing TypeBox schema, content-hash its assets, write an index
entry.

This makes the security model tractable — validation is schema validation,
not sandboxing. **Scripted/behavioural extensions are explicitly deferred**
and are not "C-398 with more time": they need a capability model, an execution
sandbox (WASM or a locked-down interpreter), a permissions surface in the UI,
and a review process that reads code rather than validating a schema. If they
are ever wanted, they are a separate ADR, not an amendment to this one.

### 5.3 Cloudflare-native identity & hosting sequence *(added 2026-08-21 — A-12/A-13/A-14/A-15)*

Supersedes D-6, D-12 and D-13's original clauses (§4.2). One contract, phased
internally so each phase is independently verifiable — see
[C-426](../contracts/C-426-cloudflare-native-identity-and-hosting.md).

| Contract | Scope | Depends on |
|---|---|---|
| **C-426** | D1 schema (replaces C-394's Neon schema) + Better Auth (Google OAuth, D1-backed) + hub SSR on Cloudflare Workers + client/hub login cutover + Turso save-backup to R2 under I-10. | C-394 (schema shape it carries forward), C-395 (R2 origin it reuses), D-17 |

This retires C-394's Neon project once C-426 lands (its schema — `packs`,
`pack_versions` — is carried forward verbatim into D1; only the `accounts`
table is retired, replaced by Better Auth's own `user` table). C-395's R2
bucket is reused, not replaced — save backups land under a `saves/` prefix
alongside the existing catalog prefix, distinguished by I-10's access-control
rule rather than a separate bucket.

## 6. Amendments

| # | Date | Change | Approved by |
|---|---|---|---|
| A-1 | 2026-08-15 | **D-6**: Cloud SQL `europe-west4` → Neon PostgreSQL 18 Free, `aws-eu-west-2` (London). Verified 2026-08-15: Neon supports AWS and Azure only — **there is no Neon GCP region**, so London is the nearest supported region to Cloud Run `europe-west4`, and the deployment is unavoidably cross-cloud. Free plan: 0.5 GB storage, 100 CU-hours/mo, 5 GB egress, scale-to-zero at 5 min (not disableable). Reconciled the now-inconsistent cross-cloud clause in the Supabase rejection (§4). | snorreks (via Claude) |
| A-2 | 2026-08-15 | **D-7**: "provision Postgres later" → provision now. User-submitted mods are committed scope (C-398), which is a mutable community feature, so the trigger condition D-7 named has been met. | snorreks (via Claude) |
| A-3 | 2026-08-15 | **D-13 added**: Cloudflare R2 as the origin for catalog asset bytes. Free egress is the deciding property for a 93 MB asset library that is meant to grow with user submissions; the `'r2'` backend already exists in `asset_sources`. | snorreks (via Claude) |
| A-4 | 2026-08-15 | **D-14 added**: catalog split by mutability — static content-addressed index for immutable artifacts, Postgres for mutable state only. Preserves the self-hosting story (D-14 lets a self-hoster run with no Postgres). | snorreks (via Claude) |
| A-5 | 2026-08-15 | **D-15 added**: the hub is publicly readable; auth gates only member actions. Follows from D-5 and reverses the current `(authenticated)`-only route layout. | snorreks (via Claude) |
| A-6 | 2026-08-15 | **I-7, I-8, I-9 added**: no asset bytes through Postgres; no Postgres in the render path of statically-renderable pages (Neon Free cold start); no dependency on Neon-proprietary surfaces. I-9 is what keeps the eventual Cloud SQL move cheap. | snorreks (via Claude) |
| A-7 | 2026-08-15 | **§5.1 added**: community hub contract sequence C-394 … C-399. | snorreks (via Claude) |
| A-8 | 2026-08-15 | **§5.2 added**: "a mod is a content pack plus assets, with no executable code"; scripted extensions explicitly deferred to a future ADR. | snorreks (via Claude) |
| A-9 | 2026-08-15 | **D-6/D-8 reconciled against the provisioned project.** The Neon project was created on **PostgreSQL 18** (not 17), AWS `eu-west-2`, compute 0.25 ↔ 2 CU, history retention 6 hours. D-8 (local ≡ production) therefore requires re-pinning C-387's devShell from `pkgs.postgresql_17` to `pkgs.postgresql_18` — verified available as 18.4. C-387's Watch Points already authorised this as a one-line re-pin that does not reopen that contract; it is carried out in C-394. Note the two operational consequences recorded in C-394's Gotchas: CU-hours bill at the *scaled* size, so the 2 CU ceiling can exhaust the 100 CU-hour monthly allowance in ~50 hours; and 6-hour history retention is the entire point-in-time-restore window, so migrations take a logical backup first. | snorreks (via Claude) |
| A-10 | 2026-08-15 | **§4.1 added** — D-13 costed against Firebase Storage rather than asserted. Key finding: the `*.firebasestorage.app` free tier is documented as US-region-only (`us-central1`/`us-west1`/`us-east1`), so a `europe-west4` bucket pays Cloud Storage rates from the first byte; the project's actual bucket location needs confirming in the console. Egress is the deciding term ($0 vs ~$0.12/GB), worth ~$112/mo per 10,000 full-library downloads. Also recorded what R2 *costs*: no identity model (hence the save-blob split), a second vendor, and no local emulator — the last collides with C-387's no-Docker directive and is handed to C-395 to resolve. | snorreks (via Claude) |
| A-11 | 2026-08-17 | **D-16 added** — the Cloud Run GPU inference plan is reversed (see `docs/strategy/mvp-assessment-2026-08-16.md` §2.4). `service` mode is a thin metered proxy over Anthropic / OpenAI / Gemini, not GCP-hosted GPUs; Cloud Run GPU (L4) at ~$0.71/hr with 20–30 s cold starts only wins at sustained high utilization, which a pre-revenue project does not have. The `deferred.md` marker's contract reference is updated from C-413 to C-418. No code changes — the `service` adapter interface already exists from C-320. | snorreks (via Claude) |
| A-12 | 2026-08-21 | **D-6/D-7 superseded** — Neon PostgreSQL → Cloudflare D1. Forced by D-17 (hub hosting moves to a Cloudflare Worker, which cannot open the raw `pg` socket Neon needs). D1 is a Worker binding, needs no Hyperdrive proxy. I-9 (no Neon-proprietary surface) becomes moot rather than violated. See §4.2. | snorreks (via Claude) |
| A-13 | 2026-08-21 | **D-12 superseded** — Firebase Auth → Better Auth (D1-backed, Google OAuth), for both the hub and the client. D-12's 2026-08-12 rationale ("no gain from migrating") no longer holds once D-13 (next) needs a per-request authorization surface R2 doesn't provide natively — Better Auth is that surface, and having it also serve D1's identity plane avoids running two live auth systems. FCM and App Check (D-2) are unaffected. See §4.2. | snorreks (via Claude) |
| A-14 | 2026-08-21 | **D-13 per-user blob clause superseded; I-10 added** — per-user Turso save-backup blobs move from Firebase Storage to Cloudflare R2, authorized by Better Auth-minted short-lived signed URLs (I-10) rather than Firebase Storage security rules. Catalog bytes (the rest of D-13) are unaffected — already on R2, already public. See §4.2. | snorreks (via Claude) |
| A-15 | 2026-08-21 | **D-17 added; §5.3 added** — the hub moves from Cloud Run (fronted by Firebase Hosting) to a Cloudflare Worker, reusing the SSR-Worker deploy path `cloudflare.ts` already anticipated (`assetsOnly: false` branch of `CloudflareAppConfig`) and already NOTEd as blocked on exactly this Neon/`pg` constraint. Executing contract: C-426. | snorreks (via Claude) |
