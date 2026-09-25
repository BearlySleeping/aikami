# Aikami — Agent Guidelines

Monorepo: AI-powered 2D JRPG platform. SvelteKit 3 + PixiJS v8 + Tauri v2
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

The game must boot, play, and save with **no sign-in**. The first run needs
network once to download starter content (C-448); every later run is fully
offline from the OPFS / Tauri FS cache. Never make a cloud call a boot
dependency.

> Firebase, Firestore, Data Connect, Cloud Run, Neon and Postgres are removed
> (C-426/C-436). References in `docs/contracts/` and old comments are history.

**Boundaries (C-455):** `scripts/` may import `apps/backend/cloudflare/src/lib/`
(the deploy operations library); no other app is importable from anywhere.
Apps get `dev`/`build`/`deploy`; packages get `build`/`test`.

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
| Backend / API | `backend-conventions` (Drizzle directly — no controller/service/repository layer) |
| UI styling | `aikami-ui` |
| Game engine | `pixijs-v8` |
| Testing | `testing` |

## 🛑 Before Structural Changes

Read `docs/guides/STRUCTURE.md` (accurate package layout) and
`docs/architecture/architecture.md`. `.context/llms.txt` indexes all docs.

## 🌿 Fresh Worktrees

- `createWorktree()` and `bun run worktree:bootstrap -- --cwd <path>` trust the
  generated `.envrc` with `direnv allow`, seed local env files, run
  `bun install --frozen-lockfile`, and generate the seven canonical Emberwatch
  artifacts. Generation is fingerprinted/cached and may be disabled explicitly
  with `--no-content`. To trust all managed worktrees on every future shell,
  copy `scripts/direnv/direnv.toml.example` to
  `~/.config/direnv/direnv.toml`; its prefix is deliberately limited to
  `~/.herdr/worktrees/aikami`.
- Raw `herdr worktree create` output is not ready until
  `bun run worktree:bootstrap -- --cwd <path>` succeeds. Worktree-local files
  stay skip-worktree and are never published.
- `subagent.message` accepts a running subagent: the message is written to a
  durable inbox and delivered in the same Pi session/worktree at the next safe
  JSON-mode process boundary, before publication or terminal completion.
- E2E in a linked worktree gets a stable checkout-scoped port offset. Never kill
  or reuse a listener merely because it answers on the expected port; preflight
  proves service/checkout identity and only stops processes spawned by the run.

## 🧪 Evidence Lane

WebGL/entity-texture before/after evidence belongs in the gitignored
`.evidence/<contract>/` lane, never `/tmp` as the only copy and never in a PR.
The lane contains paired PNGs, `montage.png`, `manifest.json`,
`checksums.sha256`, and `index.md`. Use
`bun run --cwd apps/e2e capture:evidence -- --help`; every capture must fail
closed on a non-WebGL renderer or unresolved visible entity texture.

## ✅ Verification

- Lint/format: `bun run lint` / `bun run fix` (Biome only)
- Structural guards (~1.5s, whole repo): `bun run scripts/src/lib/ops/run_guards.ts`
- Before committing: pi's `validate` tool runs fix, typecheck, and structural
  guards. The pre-commit hook separately runs `verify_bun_version.ts`. Full
  sweep: `bun moon run :validate`.
- Never commit/push without explicit user instruction

🔴 **Guards are red → fix the code, never the policy.** Do not raise a
baseline, waiver or ceiling in `scripts/src/lib/ops/guard_*_{baseline,waivers}.json`
to make a guard pass; that is a human-reviewed policy change. If a failure
names none of your files, the base is already red — say so, don't fold a fix in.

The pre-commit hook (`scripts/src/lib/ops/pre_commit.ts`) runs: bun-version
check → `:fix` (staged) → structural guards → `:typecheck` (staged).

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
