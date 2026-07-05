# Developer Workflow

Day-to-day development guide for the Aikami monorepo.

## First-Time Setup

```bash
git clone <repo>
cd aikami
bun run setup
```

The setup script checks prerequisites, installs deps, creates `.env`, and verifies everything works.

## Daily Commands

```bash
bun run dev              # Start Client dev server (http://localhost:5173)
bun run dev:all           # Start firebase + Client in herdr workspace
bun run typecheck         # Typecheck all 22 projects
bun run fix               # Auto-fix lint/format issues (Biome)
bun run lint              # Check lint/format without writing
bun run validate          # lint + format + typecheck
```

## Testing

```bash
bun run test              # Run all tests (unit + E2E via moon)
bun run test:blackbox     # Full blackbox suite (schema → functions → Client Playwright)
bun run test:blackbox client # Just Client tests
bun run test:blackbox --no-emulator  # Skip emulator startup
```

## Firebase Emulators

```bash
# Via firestack
cd apps/backend/functions
bun run emulate

# Or via the shared dev session
bun run dev:all
```

Emulator ports:
- Auth: 9099
- Firestore: 8080
- Functions: 5001
- Storage: 9199

## Adding a Feature

1. **Write a contract** in `docs/contracts/` using the [TEMPLATE](contracts/TEMPLATE.md)
2. **Implement** following the ViewModel pattern for Client, Zod schemas for data, repository pattern for Firestore
3. **Verify** with `bun run validate` then `bun run test:blackbox`
4. **Update knowledge** — run `bun run scripts -- generate_llms`

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

### Firestore Pattern
```
packages/shared/schemas/src/lib/database/my-collection.ts  # Zod schema
packages/backend/database/src/lib/my-collection.ts          # Server repo
packages/frontend/repositories/src/lib/my-collection.ts     # Client repo
```

### Common Aliases
```typescript
$lib          → apps/frontend/client/src/lib/
$logger       → packages/shared/logger/src/
$services     → apps/frontend/client/src/lib/client/services/
$views        → apps/frontend/client/src/lib/views/
@aikami/*     → packages/*/src/index.ts
```

## Scripts

```bash
bun run scripts                     # Interactive script picker
bun run scripts -- setup            # Run setup directly
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
