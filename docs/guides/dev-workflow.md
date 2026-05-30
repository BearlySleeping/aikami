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
bun run dev              # Start PWA dev server (http://localhost:5173)
bun run dev:all           # Start emulators + PWA in tmux session
bun run typecheck         # Typecheck all 22 projects
bun run fix               # Auto-fix lint/format issues (Biome)
bun run lint              # Check lint/format without writing
bun run validate          # lint + format + typecheck
```

## Testing

```bash
bun run test              # Run all tests (unit + E2E via moon)
bun run test:blackbox     # Full blackbox suite (schema → functions → PWA Playwright)
bun run test:blackbox pwa # Just PWA tests
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
2. **Implement** following the ViewModel pattern for PWA, Zod schemas for data, repository pattern for Firestore
3. **Verify** with `bun run validate` then `bun run test:blackbox`
4. **Update knowledge** — run `bun run scripts -- generate_llms`

## Project Conventions

### File Naming
- All source files: `snake_case.ts`, `snake_case.svelte`
- SvelteKit routes: `+page.svelte`, `+layout.svelte`, `+server.ts`
- Route directories: mirror URL structure

### Code Pattern (PWA)
```typescript
// apps/frontend/pwa/src/lib/views/my-feature/my-feature-view-model.svelte.ts
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
$lib          → apps/frontend/pwa/src/lib/
$logger       → packages/shared/logger/src/
$services     → apps/frontend/pwa/src/lib/client/services/
$views        → apps/frontend/pwa/src/lib/views/
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
