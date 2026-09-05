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
