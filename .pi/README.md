# Aikami — Pi AI Agent Setup

> Project-specific pi configuration: extensions, skills, custom tools, and development workflows.
> Global pi setup is documented at `~/.pi/README.md`.

---

## Relationship to ~/.pi

Aikami's `.pi/` directory extends the global `~/.pi/` setup with project-specific tooling:

| Layer | Location | Scope |
|-------|----------|-------|
| Global extensions | `~/.pi/agent/extensions/` | All projects (auto-fallback, git-checkpoint, log-offloader, model-modes, scroll-to-end) |
| Global skills | `~/.pi/skills/`, `~/.agents/skills/` | All projects (browser-tools, find-skills) |
| **Project extensions** | `.pi/extensions/` | Aikami only — moon integration, firebase tools, log viewer |
| **Project skills** | `.pi/skills/` | Aikami only — conventions, firestack, firestore, svelte, contracts, commands |

Models, observational memory, context-mode, theme, and Telegram bridge are global — configured in `~/.pi/`.

---

## Project Extensions (`.pi/extensions/`)

### 1. `moon-integration.ts` — Monorepo Orchestration
| Tool | Purpose |
|------|---------|
| `moon_detect_affected` | Query moon for changed projects |
| `moon_run_task` | Run any moon task |
| `moon_list_projects` | List all monorepo projects |
| `validate` | Fix+typecheck → optionally build+test on affected projects |

### 2. `firebase-tools.ts` — Firebase Operations
| Tool | Purpose |
|------|---------|
| `firestore_query` | Query Firestore collections |
| `firebase_deploy_functions` | Deploy functions via firestack |
| `firebase_emulator` | Start/stop/status of Firebase emulators |

### 3. `log-viewer.ts` — Unified Logs
| Tool | Purpose |
|------|---------|
| `service_logs` | View logs for Aikami services |

---

## Skills (`.pi/skills/`)

See individual skill files for details. Key skills:

| Skill | When Used |
|-------|-----------|
| `aikami-conventions` | Writing or refactoring Aikami code |
| `project-commands` | Build, test, lint, format commands |
| `firestack` | Firebase deployment, emulators |
| `contract-implementer` | Implementing features from contracts |
| `svelte-page` | Scaffolding new SvelteKit pages |

---

## Prompts (`.pi/prompts/`)

| Prompt | Purpose |
|--------|---------|
| `contract.md` | Writing feature contracts |
| `dev.md` | Development workflow and debugging protocol |
| `pre-commit.md` | Pre-commit checklist |
| `handoff.md` | Session handoff for $0 context spend |
| `anti-loop.md` | Anti-loop enforcement rules |
| `pi-test.md` | Testing .pi changes |

---

## Conventions

| Convention | Enforced By |
|------------|------------|
| Always use `moon_run_task` for build/test/typecheck | moon-integration.ts |
| Always use `validate()` instead of raw moon commands | moon-integration.ts |
| Use `ctx_execute` for analysis, not raw file reads | context-mode |
| Use `ctx_fetch_and_index` for web docs, not inline paste | context-mode |
| Svelte 5 ViewModel pattern, runes, Zod schemas | aikami-conventions skill |
