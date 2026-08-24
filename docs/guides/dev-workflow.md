# Developer Workflow

Day-to-day development guide for the Aikami monorepo.

## First-Time Setup

```bash
git clone <repo>
cd aikami
bun run setup        # local machine setup: checks bun, git, jdk, chromium, tauri deps
bun install          # install dependencies
bun run setup:env    # generate .env.emulator files (no GCP access needed)
```

The `bun run setup` script is a CLI guide that checks your local machine
(essentials like bun/git, optional DX like direnv/pi/herdr, emulator deps
like jdk/chromium, and Tauri build deps) and prints install commands for
anything missing.

`bun run setup:env` (`download_secrets.ts --mode emulator`) writes each
app's `.env.emulator` from `.env.example` plus safe fake values for the
handful of keys required at runtime — the
`demo-aikami-emulator` project isn't real, so no GCP/gcloud access is
needed. Contributors without staging/production access still get a
working local build this way; `bun run download-secrets --mode staging`
(or `production`) is the separate, GCP-authenticated path for those who
have it. Re-running `setup:env` never clobbers values you've since
customized in `.env.emulator` — only fills in what's still missing.

> 🔴 `bun run setup` sets up YOUR machine. The GCP cloud project wizard is
> a separate command: `bun run project:setup` (see docs/intro/setup.md).

> ⚠️ Not using the Nix flake (e.g. Windows/direnv-less setups)? The first
> `bun moon run ...` will otherwise have moon download its own separate
> "latest" Bun via proto, alongside the Bun you already installed. Set
> `MOON_TOOLCHAIN_FORCE_GLOBALS=true` in your shell profile to make moon
> use your installed Bun instead — flake.nix sets this automatically, and
> CI does the same (`.github/workflows/pr-checks.yml`).

## Daily Commands

```bash
bun run dev              # Start Client dev server (http://localhost:5173)
bun moon run hub:dev     # Start Hub dev server (apps/frontend/hub)
bun run dev:all           # Start all dev services in a herdr workspace
bun run typecheck         # Typecheck all 22 projects
bun run fix               # Auto-fix lint/format issues (Biome)
bun run lint              # Check lint/format without writing
bun run validate          # lint + format + typecheck
```

## Testing

```bash
bun run test              # Run all tests (unit + E2E via moon)
bun run test:blackbox     # Full blackbox suite (schema → API → Client Playwright)
bun run test:blackbox client # Just Client tests
bun run test:blackbox --no-emulator  # Skip emulator startup
```

## Database

The server data plane is **Cloudflare D1**. Schema, migrations, and local
workflow are covered in [Database](database.md).

```bash
bun run db:generate   # generate a migration from the Drizzle schema
bun run db:migrate    # apply pending migrations locally
bun run db:status     # how many migrations are applied
```

> The legacy Postgres path (`bun postgres:start`, Neon connection strings) is
> still present for the C-426 rollback window and is removed in **C-436**. New
> work should target D1.

## Local Cloudflare runtime

The hub deploys as a Cloudflare Worker with D1 and R2 bindings. `bun moon run
hub:dev` currently runs plain Vite, which does **not** provide those bindings —
a local `wrangler dev` service that does is tracked as **C-437**.

## Adding a Feature

All feature development flows through the **Contract Pipeline**. See the full guide:

📄 **[docs/guides/contract-pipeline.md](contract-pipeline.md)**

Quick start:

```bash
# Chat-draft a new feature (auto-generates contract, no worktree):
bun run contract --source prompt --root

# Run an existing contract (skips writer + critique, starts implementation):
bun run contract C-370 --root

# From a GitHub Issue:
bun run contract --source issue #102
```

The pipeline orchestrates: **Write → Critique → Implement → Verify → Review → Merge**,
with Pi AI agents handling each stage in isolated Herdr workspaces.

## Project Conventions

### File Naming
- All source files: `snake_case.ts`, `snake_case.svelte`
- SvelteKit routes: `+page.svelte`, `+layout.svelte`, `+server.ts`
- Route directories: mirror URL structure

### Code Pattern (Client)
```typescript
// apps/frontend/client/src/lib/views/my-feature/my-feature-view-model.svelte.ts
export interface MyFeatureViewModel { ... }
export class MyFeatureViewModelImpl implements MyFeatureViewModel { ... }
```

- View: `MyFeatureView.svelte` — pure template, no logic
- ViewModel: `my-feature-view-model.svelte.ts` — all logic, `$state` for reactivity

### Data Layer Pattern (local-first)

```
packages/shared/schemas/src/lib/database/my-collection.ts   # TypeBox schema
packages/backend/database/src/lib/repositories/my_repo.ts   # Server repo (Cloudflare D1)
packages/frontend/repositories/src/lib/my-collection.ts     # Client repo (TursoStorageAdapter)
```

Campaign, save, and chat data lives in the local Turso (libSQL) store (C-321) via
`packages/frontend/repositories` — never raw IndexedDB, and never a cloud store for
campaign data.

### Common Aliases
```typescript
$lib          → apps/frontend/client/src/lib/
$logger       → packages/shared/logger/src/
$services     → apps/frontend/client/src/lib/services/
$views        → apps/frontend/client/src/lib/views/
@aikami/*     → packages/*/src/index.ts
```

## Scripts

```bash
bun run scripts                     # Interactive script picker
bun run scripts -- setup            # Local machine setup guide
bun run scripts -- project:setup    # GCP project setup wizard (maintainers)
bun run scripts -- generate_llms    # Regenerate .context/llms.txt
bun run scripts -- validate_all     # Full CI validation
```

## Troubleshooting

- **Typecheck fails after pull**: Run `bun run moon sync` then retry
- **Emulator port conflicts**: `lsof -ti:4000,8080,9099,5001,9199 | xargs kill`
- **Moon cache issues**: Delete `.moon/cache` and re-run `bun run moon sync`
- **ENOSPC: System limit for file watchers reached**: This means inotify watchers are exhausted. The monorepo's `examples/` directory (~312K files) is the primary culprit. The Vite configs already exclude it via `server.watch.ignored`. If the error persists, tighten further to `.ts`/`.svelte`-only:
  ```ts
  // In vite.config.ts — chokidar negation pattern
  server: {
    watch: {
      ignored: ['**', '!apps/frontend/client/src/**', '!packages/**/src/**'],
    },
  },
  ```
  Or kill stale watchers: `pkill -f 'vite dev'` then retry.
