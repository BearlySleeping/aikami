# Aikami — Agent Guidelines

Monorepo: AI-powered 2D JRPG platform. SvelteKit 2 + PixiJS v8 + Tauri v2
client, Firebase backend, local AI microservices. Bun runtime, Moon
orchestrator, Biome linting (never Prettier/ESLint).

## 📂 Directory Layout

🔴 **Moon project IDs are flat names; filesystem paths are nested.** The
client lives at `apps/frontend/client/` — **not** `apps/client/`.

| Path prefix | Contents |
|---|---|
| `apps/frontend/` | client (SvelteKit+PixiJS+Tauri), site (Astro), docs (Starlight) |
| `apps/backend/` | firebase (Functions+Data Connect), image (ComfyUI), text (Ollama), voice (Kokoro) |
| `apps/e2e/` | E2E test suite |
| `packages/shared/` | constants, schemas, types, logger, utils, mocks, parser |
| `packages/frontend/` | configs, dataconnect, engine, repositories, services, utils |
| `packages/backend/` | ai, auth, chat, configs, database, image, svelte-kit, utils |
| `scripts/` | Build/infra scripts |
| `.pi/` | Pi agent extensions, skills, prompts |

## 🧠 Skills — Load Before Coding

Skills live in `.pi/skills/` (project rules) and `.pi/generated-skills/`
(vendored upstream docs: PixiJS, daisyUI, Firebase, firestack, herdr). Pi
discovers them automatically — load the matching skill BEFORE writing code:

| Task | Required skill(s) |
|---|---|
| **Any code** | `aikami-conventions` (universal: logger, imports, TS rules, boundaries) |
| Frontend / Svelte | `svelte-conventions` (runes, Views/ViewModels, services) |
| Backend / Functions | `backend-conventions` (controller → service → repository) |
| UI styling | `aikami-ui` |
| Game engine | `pixijs-v8` |
| Data Connect | `dataconnect` (🔴 generate ONLY via `bun moon run firebase:generate`) |
| Firestore collections | `firestore-collection` |
| Deploy / emulators | `firestack` |
| Testing | `testing` |

Agents without skill support: read the SKILL.md files above directly from
`.pi/skills/<name>/SKILL.md`.

## 🛑 Before Structural Changes

Read `.context/CONTEXT.md` (stack versions, structure) and `.context/index.md`
(module map, boundary rules).

## ✅ Verification

- Lint/format: `bun run lint` / `bun run fix` (Biome only)
- Full validation: `bun moon run :validate` (or pi's `validate()` tool)
- Never commit/push without explicit user instruction
