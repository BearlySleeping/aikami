# Aikami — Agent Guidelines

Monorepo: AI-powered 2D JRPG platform. SvelteKit 2 + PixiJS v8 + Tauri v2
client, Cloudflare Workers backend (D1 + R2 + Better Auth), local AI
microservices. Bun runtime, Moon orchestrator, Biome linting (never
Prettier/ESLint).

## 📂 Directory Layout

🔴 **Moon project IDs are flat names; filesystem paths are nested.** The
client lives at `apps/frontend/client/` — **not** `apps/client/`.

| Path prefix | Contents |
|---|---|
| `apps/frontend/` | client (SvelteKit+PixiJS+Tauri), hub (SSR → CF Worker), site (Astro), docs (Astro) |
| `apps/backend/` | local-stack (Docker topology), text (llama.cpp), image (sd-server), voice (sherpa-onnx/Kokoro), worker (jobs + Discord bot) |
| `apps/e2e/` | E2E test suite |
| `packages/shared/` | constants, schemas, types, logger, utils, mocks, parser |
| `packages/frontend/` | configs, engine, repositories, services, components, utils |
| `packages/backend/` | ai, auth, chat, configs, database, svelte-kit, utils |
| `scripts/` | Build/infra scripts |
| `.pi/` | Pi agent extensions, skills, prompts |

## 🗄️ Data Planes — Do Not Confuse

| Plane | Store | Owns |
|---|---|---|
| **Player device** | Turso (libSQL) | Campaigns, saves, chat history. Source of truth. Works offline. |
| **Server** | Cloudflare D1 | Identity (Better Auth), community packs, save-backup metadata. |
| **Blobs** | Cloudflare R2 | Catalog assets, save backups. |

The game must boot, play, and save with **no network and no sign-in**. Never
make a cloud call a boot dependency.

> Firebase, Firestore, Data Connect, Cloud Run, and Neon Postgres have all been
> removed or are being decommissioned. You will still find references in
> `docs/contracts/` and older code comments — those are history, not the target.
> The Postgres path in `packages/backend/database` survives only for the C-426
> rollback window and is deleted in C-436.

## 🧠 Skills — Load Before Coding

Skills live in `.pi/skills/` (project rules) and `.pi/generated-skills/`
(vendored upstream docs). Canonical coding examples live in
`.pi/guidance/examples/`. Active guidance is tracked in
`.pi/guidance/manifest.json`. See each skill's SKILL.md for details.

**Required skills per task:**

| Task | Skill |
|---|---|
| Any code | `aikami-conventions` (logger, imports, TS rules) |
| Frontend / Svelte | `svelte-conventions` (runes, MVVM) |
| Backend / API | `backend-conventions` (controller → service) |
| UI styling | `aikami-ui` |
| Game engine | `pixijs-v8` |
| Testing | `testing` |

## 🛑 Before Structural Changes

Read `.context/CONTEXT.md` (stack versions, structure) and `.context/index.md`
(module map, boundary rules).

## ✅ Verification

- Lint/format: `bun run lint` / `bun run fix` (Biome only)
- Full validation: `bun moon run :validate` (or pi's `validate()` tool)
- Never commit/push without explicit user instruction

### Validate through Moon, never with a bare tool

Run checks through a project's Moon task (or its package script) — Moon
supplies prerequisites that a directly-invoked tool does not.

| Goal | Command |
|---|---|
| One project's typecheck / test / lint | `bun moon run <project>:typecheck` · `<project>:test` · `<project>:lint` |
| Everything affected by a diff | `bun moon ci --base=origin/main` |
| Full sweep (all projects) | `bun moon run :validate` |

🔴 **Never run `bun test <file>` from a project directory to "just check one
file".** Some suites generate required artifacts before Bun starts, and the
failure is misleading. The hub is the trap: `apps/frontend/hub/tsconfig.test.json`
`extends` the generated `.svelte-kit/tsconfig.json`, so a bare `bun test` sees no
path mappings and dies with `Cannot find module
'@aikami/backend/svelte-kit/hooks_helpers'`. Run `bun moon run hub:test` instead —
its `test:unit` script runs `svelte-kit sync` + `scripts/write_test_tsconfig.ts`
first.

🔴 **`Cannot find module '<package>'` during typecheck is an install gap, not a
code bug.** Run `bun install --frozen-lockfile` at the repo root and re-run. Do
not edit `package.json`/`bun.lock` or hand-create `node_modules` links to silence
it. (`@bearly/flock`, for example, is a declared dependency of
`apps/backend/local-stack`; a missing link means the tree is incomplete.)

`bun run typecheck` at the root is `moon run :typecheck` — it runs **every**
project, so it is slow and surfaces unrelated gaps. Prefer a single
`<project>:typecheck` or the affected-only `bun moon ci --base=origin/main`.
