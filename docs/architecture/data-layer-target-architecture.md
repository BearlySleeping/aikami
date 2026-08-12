# Data Layer — Target Architecture (ADR)

> **This is a reference document, not a contract. Do not "implement" this file.**
> Contracts C-383 … C-386 execute it. When a contract and this document
> disagree, this document wins — raise an amendment on the contract.

**Decided:** 2026-08-12
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
| **D-6** | **One Cloud SQL for PostgreSQL instance, `europe-west4`, reached only through the hub's Elysia API.** | No browser ever holds a database credential. All authorization is server-side middleware. |
| **D-7** | **Postgres is provisioned when the first mutable community feature ships — not before.** | Until then the catalog is a static JSON index in Cloud Storage. |
| **D-8** | **Local development uses real PostgreSQL** (Nix-provided), not pglite, not an emulator. | Local ≡ production. Removes the class of bug hit in C-374. |
| **D-9** | **Drizzle owns SQL schema and migrations** for both the local SQLite plane and the server Postgres plane. They are separate schemas that share idiom, not definitions. | No hand-written DDL string arrays. No home-grown codegen. |
| **D-10** | **Staging is on hold** until there is a working app and a user base. | Production-only spend. `firestack.config.ts` mode handling must not break. |
| **D-11** | **No runtime Redis.** | Upstash stays in the deploy pipeline (`scripts/src/lib/deploy/cache.ts`) only. |
| **D-12** | **Firebase Auth is kept.** No migration to Supabase Auth or any alternative. | Session cookies, custom claims, Storage rules and App Check all continue to work unchanged. |

## 2. The three planes

```
┌─ DEVICE ────────────────────────────────────────────────────┐
│ Turso / libSQL  (Tauri native + WASM/OPFS)                  │
│ SOURCE OF TRUTH for everything the player owns              │
│ campaigns · saves · sessions · checkpoints · journal        │
│ chat · personas · npc state · asset install state           │
│ Reached by: the client, directly. Never by the hub.         │
└─────────────────────────────────────────────────────────────┘
┌─ ACCOUNT & CATALOG ─────────────────────────────────────────┐
│ Static JSON index (Cloud Storage + CDN)  ← immutable        │
│ Cloud SQL Postgres (europe-west4)        ← mutable, later   │
│ content packs · lpc · sprites · maps · music · assets       │
│ ratings · download counts · submissions · moderation        │
│ Reached by: the hub's Elysia API ONLY. Never a browser.     │
└─────────────────────────────────────────────────────────────┘
┌─ IDENTITY & BLOBS ──────────────────────────────────────────┐
│ Firebase Auth · Storage · FCM · App Check                   │
│ sign-in · save blobs · pack payloads · sprite/audio binaries│
│ Reached by: client via rules; server via Admin SDK.         │
└─────────────────────────────────────────────────────────────┘
```

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

## 4. Explicitly rejected

Recorded so they are not re-proposed.

| Rejected | Why |
|---|---|
| Firebase Data Connect | Operation-level auth only, no client transactions, hand-applied migrations, browser SDK in SSR, home-grown schema parser, excluded from prod. Costs the same Cloud SQL money as going direct. |
| Supabase (DB, Auth, or Functions) | Compute is on GCP `europe-west4`; cross-cloud adds 10–30ms + egress per query. Edge Functions' timeouts are wrong for LLM streaming. Auth migration would break Storage rules, FCM and App Check for zero gain. |
| whole-DB libSQL sync to Turso cloud | Granularity is per-database; per-user tenancy would need N databases, which makes the cross-user catalog queries the hub exists for impossible. Also replicates chat transcripts to the cloud, changing the BYOK privacy posture by accident. |
| Firestore for the community catalog | The catalog is relational (packs↔assets↔tags↔ratings). Adding a Firestore domain while removing Firestore is self-defeating. |
| AlloyDB / Spanner | Orders of magnitude more cost and complexity than the workload. |
| Self-hosted Postgres on always-free `e2-micro` | Saves ~$10/mo in exchange for owning backups, patching and uptime with no HA. Wrong trade for a solo maintainer. |
| Runtime Redis | Every required dependency taxes self-hosters. Nothing needs it yet. |

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

Cloud SQL provisioning and the community catalog itself are **not** in this
sequence. They come after C-387, in a contract written when the first catalog
feature is specified (D-7).
