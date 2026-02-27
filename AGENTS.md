# AIKAMI - Developer Guidelines

This document provides guidelines for AI coding agents working on the Aikami project.

## Project Overview

Aikami is a monorepo using **moon** for task orchestration, **Bun** as the runtime, and **SvelteKit** for the frontend PWA. The project uses **Biome** for linting/formatting and **Playwright** for testing.

### Tech Stack

- **Runtime**: Bun
- **Frontend**: SvelteKit 2, Svelte 5 (with runes: `$state`, `$derived`, `$effect`)
- **Backend**: Firebase, SvelteKit API routes
- **Testing**: Playwright
- **Linting/Formatting**: Biome
- **Task Runner**: moon

---

## Build, Lint, and Test Commands

**Always use moon** from the root directory to leverage caching. Never `cd` into project directories.

```bash
bun moon run {project}:{task} -- --{options}
```

### Root Commands (monorepo-wide)

```bash
# Development (local)
bun moon run :fix              # Auto-fix all (format + lint + imports) - run before committing
bun moon run :validate         # Typecheck + test - CI pipeline

# Granular commands
bun moon run :format           # Format code
bun moon run :lint             # Lint only (no auto-fix)
bun moon run :typecheck        # TypeScript type checking

# Building
bun moon run :build            # Build all projects
bun moon run :build --affected # Build affected projects only

# Testing
bun moon run :test             # Run all tests
bun moon run :test --watch    # Run tests in watch mode
```

### Dependency Management

This project uses **syncpack** to manage consistent dependency versions across all projects in the monorepo.

```bash
# Update all dependencies to latest version across ALL projects
bun run deps:update

# Sync/fix dependency versions to be consistent across all projects
# This resolves conflicts by finding a version that works for all
bun run deps:sync

# Check for version mismatches (useful for CI)
bun run deps:check

# List all dependencies with their versions
bun run deps:list
```

**Important**: 
- Run `bun run deps:sync` after adding new dependencies to ensure consistency
- Run `bun run deps:update` periodically to get latest versions

### Development Workflow

**Always run these before committing:**

```bash
# Quick fix + test (recommended before commit)
bun moon run pwa:fix      # Auto-fix format + lint
bun moon run pwa:test    # Run tests

# Full validation (for CI)
bun moon run pwa:validate  # typecheck + test
```

Or manually:
```bash
# In project directory
bun biome check --write src/   # Fix lint/format issues
bun run test:unit             # Run unit tests
```

---

### Per-Project Commands

```bash
# Fix (auto-fix everything) - USE THIS BEFORE COMMITTING
bun moon run pwa:fix

# Validate (typecheck + test) - FOR CI
bun moon run pwa:validate

# Granular
bun moon run pwa:lint
bun moon run pwa:format
bun moon run pwa:typecheck
bun moon run pwa:test
```

### Running Single Tasks (per project)

```bash
# PWA examples (project name: pwa)
bun moon run pwa:test -- tests/basic.spec.ts
bun moon run pwa:test -- -g "should render"
bun moon run pwa:test -- --ui

bun moon run pwa:lint
bun moon run pwa:lint --write
bun moon run pwa:format
bun moon run pwa:format --write
bun moon run pwa:check
bun moon run pwa:dev

# Other projects
bun moon run utils:lint
bun moon run schemas:test
bun moon run auth:build
```

### Project Names

Common project names (use in `bun moon run {name}:{task}`):
- `pwa` - Frontend PWA
- `docs` - Documentation
- `landing-page` - Landing page
- `functions` - Backend Cloud Functions
- `utils` - Shared utilities
- `schemas` - Zod schemas
- `types` - TypeScript types
- `constants` - Shared constants
- `frontend-services` - Frontend services package
- `frontend-utils` - Frontend utilities package
- `backend-auth` - Auth backend
- `backend-database` - Database backend
- `backend-ai` - AI backend

---

## Code Style Guidelines

### Formatting (Biome)

The project uses **Biome** with these settings (from `biome.json`):

- **Indent**: 2 spaces (not tabs)
- **Line width**: 100 characters
- **Quotes**: Single quotes for JS/TS, double quotes for JSX
- **Trailing commas**: All (es5)
- **Semicolons**: Always
- **Arrow parentheses**: Always

Run formatting before committing:

```bash
bun run format:write
```

### Naming Conventions

- **Files**: kebab-case (e.g., `character-service.svelte.ts`, `auth.utils.ts`)
- **Classes**: PascalCase (e.g., `CharacterService`, `LoginViewModel`)
- **Functions/variables**: camelCase (e.g., `importFile`, `selectedCharacter`)
- **Constants**: SCREAMING_SNAKE_CASE for true constants, camelCase for readonly
- **Types/Interfaces**: PascalCase with `type`/`interface` suffix when ambiguous

### Imports

- Use **explicit type imports** when importing types: `import type { Character } from '$types'`
- Use **path aliases** defined in `tsconfig.json`:
  - `$lib` - lib folder
  - `$types` - @aikami/types
  - `$services` - frontend services
  - `$logger` - @aikami/logger
- Group imports: external → internal → relative
- Use **named exports** over default exports
- **Always include file extensions** in relative imports:
  - `import { something } from './foo.ts';`
  - `import { something } from './bar.svelte.ts';`
  - Never: `import { something } from './foo';`

### TypeScript

- **Always** use explicit return types for exported functions
- Use `unknown` over `any`; if `any` is needed, add a comment explaining why
- Prefer **Zod** for runtime validation (use schemas from `@aikami/schemas`)
- Use **interface** for object shapes that may be extended, **type** for unions/intersections

Example:

```typescript
import type { Character } from "$types";
import { z } from "zod";

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type Character = z.infer<typeof CharacterSchema>;
```

### Svelte 5 Runes

This project uses Svelte 5 with runes:

- Use `$state` for reactive state
- Use `$derived` for computed values
- Use `$effect` for side effects
- Use `$props` for component props

```typescript
class CharacterService {
  characters = $state<Character[]>([]);
  selectedCharacter = $state<Character | null>(null);

  selectedCount = $derived(this.characters.length);
}
```

### Interface Definition

All interfaces for services, view models, and component props **must** have JSDoc comments:

```typescript
/**
 * Service interface for managing characters in the application.
 * Provides methods for importing, adding, and selecting character data.
 */
export type CharacterServiceInterface = BaseFrontendClassInterface & {
  /**
   * List of all imported characters.
   * @readonly - Use addCharacter() to modify
   */
  readonly characters: Character[];

  /**
   * Currently selected character for chat or editing.
   * @readonly - Use selectCharacter() to modify
   */
  readonly selectedCharacter: Character | null;

  /**
   * Imports a character from a file (PNG or JSON).
   * @param file - The file to import
   * @returns The imported Character or null if import failed
   */
  importFile(file: File): Promise<Character | null>;

  /**
   * Adds a character to the characters list.
   * @param char - The character to add
   */
  addCharacter(char: Character): void;
};
```

**Rules:**
1. **Always use `readonly`** for state properties in interfaces - enforce mutation through methods
2. **Use `@readonly`** annotation to document that direct assignment is prohibited
3. **All fields must have JSDoc comments** describing their purpose
4. **All methods must have JSDoc comments** with @param descriptions

### Component Props

All Svelte component props must have JSDoc comments:

```typescript
<script lang="ts">
/**
 * Props for the CharacterCard component.
 * Displays character information including name, avatar, race/class/level, and personality details.
 */
type Props = {
  /** The character's display name */
  name: string;
  /** URL to the character's avatar image */
  avatarUrl?: string;
  /** The character's race (e.g., Human, Elf, Dwarf) */
  race?: string;
  /** The character's class (e.g., Warrior, Mage, Rogue) */
  characterClass?: string;
  /** The character's current level */
  level?: number;
  /** Brief personality trait description */
  personalityTraits?: string;
  /** Character background/backstory */
  background?: string;
};

const { name, avatarUrl, race, characterClass, level, personalityTraits, background }: Props = $props();
</script>
```

### ViewModel-View Pattern

Views should be passive and delegate all logic to the view model:

1. **NEVER use `onMount`** to initialize data - the `BaseViewModelContainer` calls `initialize()` automatically
2. **NEVER have local `$state`** in views - all state belongs in the view model
3. **NEVER have local functions** in views - all behavior should be in the view model
4. **Views should only** receive props and render - delegate all actions to the view model

```typescript
// ❌ WRONG - Don't do this in a view
<script lang="ts">
const { viewModel }: Props = $props();

let showGreeting = $state(true); // Local state - BAD!

onMount(() => { // onMount initialization - BAD!
  if (viewModel.npc) {
    viewModel.loadChatHistory();
  }
});

function handleSend(text: string) { // Local function - BAD!
  showGreeting = false;
  viewModel.sendMessage(text);
}
</script>

// ✅ CORRECT - Do this instead
<script lang="ts">
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <!-- Use viewModel state directly -->
  {#if viewModel.showGreeting}
    <CharacterCard ... />
  {/if}
  
  <!-- Delegate to viewModel methods -->
  <ChatContainer onSend={(text) => viewModel.sendMessage(text)} />
</BaseViewModelContainer>
```

The view model should:
- Handle initialization in `initialize()` method (called by BaseViewModelContainer)
- Expose all UI state as properties
- Expose all UI actions as methods

The frontend uses a **BaseFormViewModel** pattern for form handling:

- View models extend `BaseFormViewModel` from `@aikami/frontend/services`
- Use private `_` prefix for internal state fields
- Use `$derived` for public getters
- Follow the naming pattern: `get[Name]ViewModel` factory function

```typescript
export type LoginViewModelInterface = BaseFormViewModelInterface<
  typeof LoginFormSchema
> & {
  readonly isSocialSigningIn: boolean;
  socialLogin(provider: string): Promise<void>;
};

class LoginViewModel extends BaseFormViewModel<
  typeof LoginFormSchema,
  LoginViewModelOptions
> {
  private _isSocialSigningIn = $state<boolean>(false);
  isSocialSigningIn = $derived(this._isSocialSigningIn);
}

export const getLoginViewModel = (
  options: LoginViewModelOptions
): LoginViewModelInterface => new LoginViewModel(options);
```

---

## Error Handling

Use the **AppError** system from `@aikami/utils`:

```typescript
import { toAppError, toAppErrorFromUnknownError } from "@aikami/utils";

// Known error types
throw toAppError("not-found", "Resource not found");
throw toAppError("invalid-argument", "Invalid email address");
throw toAppError("unauthorized", "User not logged in");
throw toAppError("internal", "Something went wrong", { extra: "data" });

// Handling unknown errors
try {
  await doSomething();
} catch (err) {
  const appError = toAppErrorFromUnknownError(err);
  // Handle the standardized error
}
```

**Valid error types**: `cancelled`, `invalid-argument`, `deadline-exceeded`, `not-found`, `already-exists`, `permission-denied`, `resource-exhausted`, `failed-precondition`, `aborted`, `out-of-range`, `unimplemented`, `unavailable`, `unauthenticated`, `unknown`, `internal`, `data-loss`

---

## Component Structure

### File Organization

```
src/
├── lib/
│   ├── client/
│   │   ├── services/      # Service classes (singleton pattern)
│   │   └── utils/         # Client utilities
│   ├── server/
│   │   └── utils/         # Server-only utilities
│   ├── types/             # TypeScript types
│   ├── views/             # View models and components
│   │   └── [feature]/
│   │       ├── [feature]-view-model.svelte.ts
│   │       └── components/
│   └── constants/        # App constants
├── routes/                # SvelteKit routes
│   ├── (authenticated)/  # Protected routes
│   ├── (unauthenticated)/ # Public routes
│   └── api/               # API endpoints
└── tests/                 # Playwright tests
```

### Component Patterns

- **Services**: Singleton instances exported at module level
- **View Models**: Factory functions returning interfaces
- **API Routes**: Use `createApiHandler` from `@aikami/utils`

---

## Service Architecture

### NEVER use Svelte stores

All state must be contained within services in `apps/frontend/pwa/src/lib/client/services/`. Never create files in `apps/frontend/pwa/src/lib/stores/`.

### Service File Structure

All services must follow this exact pattern:

1. **File name**: Must have `.svelte.ts` suffix (e.g., `character-service.svelte.ts`)
2. **Define Options type**: Create `ServiceNameOptions` extending `BaseFrontendClassOptions`
3. **Extend BaseFrontendClass**: Always import and extend `BaseFrontendClass<ServiceNameOptions>`
4. **Create Interface**: Define an interface that extends `BaseFrontendClassInterface`
5. **Implement Interface**: The class must implement its interface
6. **Export Singleton with options**: Pass options when creating the singleton instance

```typescript
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from "@aikami/frontend/services";
import type { Character } from "$types";

export type CharacterServiceOptions = BaseFrontendClassOptions;

export type CharacterServiceInterface = BaseFrontendClassInterface & {
  readonly characters: Character[];
  getCharacter(id: string): Promise<Character | null>;
};

class CharacterService
  extends BaseFrontendClass<CharacterServiceOptions>
  implements CharacterServiceInterface
{
  characters: Character[] = $state([]);

  async getCharacter(id: string): Promise<Character | null> {
    return await characterRepository.getDocument({ id });
  }
}

export const characterService: CharacterServiceInterface = new CharacterService({
  className: 'CharacterService',
});
```

**Important**: Do NOT pass options in the constructor. Pass them when creating the singleton:

```typescript
// ❌ WRONG
class CharacterService extends BaseFrontendClass {
  constructor() {
    super({ className: 'CharacterService' }); // Don't do this
  }
}
export const characterService = new CharacterService();

// ✅ CORRECT
export const characterService = new CharacterService({
  className: 'CharacterService',
});
```

### Exporting Services

All services must be exported from `apps/frontend/pwa/src/lib/client/services/index.ts`:

```typescript
export * from "./database/npc.svelte";
export * from "./character-service.svelte";
```

### Using Services in Views

Import services from `$services` alias:

```typescript
import { characterService, npcService } from "$services";
```

### Utility Classes (Non-Service)

If you need a class that doesn't require the base class (like a pure utility), it still needs the `.svelte.ts` suffix but can skip the base class:

```typescript
// Valid: Utility class with .svelte.ts suffix
export class CharacterImporter {
  static importFromPng(file: File): Promise<Character | null> {
    // ...
  }
}
```

---

## Testing Guidelines

Tests use **Playwright** with the following patterns:

```typescript
import { expect, test } from "@playwright/test";

test.describe("Feature Name", () => {
  test("should do something", async ({ page }) => {
    await page.goto("/route");
    await expect(page.getByRole("heading")).toBeVisible();
  });
});
```

- Put tests in `tests/` directory in each app
- Use semantic test names describing the behavior
- Use `test.describe` to group related tests
- Use Playwright's built-in locators (`getByRole`, `getByText`, etc.)

---

## Git Conventions

- **Commits**: Use conventional commits (e.g., `feat: add login`, `fix: auth error`)
- **Branch naming**: `feature/description`, `fix/description`, `refactor/description`
- **PRs**: Include description of changes and testing done

---

## Additional Notes

- **Logger**: Use `@aikami/logger` for logging (`import logger from '$logger'`)
- **Zod**: All form validation should use Zod schemas
- **Firebase**: Auth operations go through services in `@aikami/frontend/services`
- **API**: All API endpoints use the `handleXxxEndpoint` pattern with `createApiHandler`
