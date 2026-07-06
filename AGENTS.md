# Repository Agent Guidelines & Skills Index

This repository contains structured architectural context layouts and domain-specific knowledge matrices optimized for code agents.

## 📂 Directory Layout

Monorepo with nested app categories. 🔴 Moon project IDs ≠ filesystem paths.

| Path prefix | Contents |
|---|---|
| `apps/frontend/` | client (SvelteKit+PixiJS+Tauri), site (Astro landing), docs (Astro Starlight) |
| `apps/backend/` | firebase (Cloud Functions+DataConnect), image (ComfyUI), text (Ollama), voice (Kokoro) |
| `apps/e2e/` | E2E test suite |
| `packages/shared/` | constants, schemas, types, logger, utils, mocks, parser |
| `packages/frontend/` | configs, dataconnect, engine, repositories, services, utils |
| `packages/backend/` | ai, auth, chat, configs, database, image, svelte-kit, utils |
| `scripts/` | Build/infra scripts |
| `.pi/` | Pi agent extensions, skills, prompts |

🔴 **Critical:** The client source lives at `apps/frontend/client/` — **not** `apps/client/`. All moon project IDs are flat names; their filesystem sources are nested under `apps/frontend/`, `apps/backend/`, `packages/shared/`, etc.

---

## 🛑 Architectural Execution Rules

Before modifying code layout or proposing code completions, you must ingest our structural guidelines:

1. Read `.context/CONTEXT.md` to inspect current stack version targets and structural directories.
2. Read `.context/index.md` to map workspace modules and active boundary rules.

---

## 🧠 Codebase Skills & Constraints Index (`.pi/skills/`)

We maintain isolated framework skill sheets and configuration guides under the `.pi/skills/` directory. You must read and strictly implement the design blueprints found in these directories when modifying code:

### 1. Frontend Client Architecture (Svelte 5 Runes & PixiJS)

- **MVVM ViewModel Pattern:** Read `.pi/skills/svelte-page/SKILL.md` and `.pi/skills/aikami-conventions/SKILL.md`. All template interaction rules belong inside pure Svelte files (`+page.svelte`), while underlying reactive states and logic must be isolated in companion files named `*_view_model.svelte.ts`.
- **Game Rendering Loop:** Read `.pi/skills/pixijs-v8/SKILL.md` and items inside `.pi/skills/pixijs/` to construct or update bitECS tracking states and PixiJS canvas render groups.

### 2. Backend Infrastructure & Tooling

- **Firebase Strategy (`firestack`):** Read `.pi/skills/firestack/SKILL.md` and sub-references before writing Firestore rules, updating Cloud Functions, or editing Data Connect schemas.
- **Desktop Runtime Shell:** Read `.pi/skills/tauri-v2/SKILL.md` for Tauri cross-compilation restrictions.

### 3. Syntax Formatting & Verification Standards

- **Lint Enforcement:** We strictly use Biome for system-wide checking. Do not use Prettier or ESLint. Code structure patterns must be verified via `bun run lint` and formatted via `bun run fix`. Refer to `.pi/skills/aikami-standards/SKILL.md`.
- **Test suites:** Review code assertion guidelines inside `.pi/skills/testing/SKILL.md` before deploying or refactoring software blocks.
