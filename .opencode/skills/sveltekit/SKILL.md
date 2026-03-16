---
name: sveltekit
description: Best practices, patterns, and conventions for SvelteKit 2.x development with Svelte 5 runes. Includes project structure, service architecture, view model patterns, and testing guidelines.
version: 1.0.0
author: Aikami Team
tags: ["sveltekit", "svelte", "svelte5", "typescript", "web", "pwa"]
---

# SvelteKit Development Skill

This skill provides comprehensive guidelines for building SvelteKit applications following the Aikami project's strict standards. Use this skill when working with SvelteKit projects.

## 1. Project Architecture

### Directory Structure

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
│   └── constants/         # App constants
├── routes/                # SvelteKit routes
│   ├── (authenticated)/  # Protected routes
│   ├── (unauthenticated)/ # Public routes
│   └── api/              # API endpoints
└── tests/                # Playwright tests
```

### Route Standard

All page routes must follow this pattern:

```typescript
<script lang="ts">
import { getChatViewModel } from '$views/chat/chat-view-model.svelte.ts';
import ChatView from '$views/chat/ChatView.svelte';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const viewModel = getChatViewModel({
  className: 'ChatViewModel',
  // svelte-ignore state_referenced_locally
  npcId: data.id,
});
</script>

<ChatView {viewModel} />
```

**Rules:**

1. Always use `$views/` path alias for importing view models and views
2. Always use `getXxxViewModel` factory function to create the view model
3. Always pass `className` as the first option
4. Use `// svelte-ignore state_referenced_locally` for props used in viewModel options
5. Use `$props()` to get route data from `data` prop
6. Views should accept `viewModel` as a prop and use `BaseViewModelContainer`

---

## 2. Svelte 5 Runes

This project uses Svelte 5 with runes:

### State Management

```typescript
class CharacterService {
  characters = $state<Character[]>([]);
  selectedCharacter = $state<Character | null>(null);

  // Computed value
  selectedCount = $derived(this.characters.length);

  // Effect
  $effect(() => {
    console.log('Selected character changed:', this.selectedCharacter);
  });
}
```

### Component Props

All Svelte component props must have JSDoc comments:

```typescript
<script lang="ts">
/**
 * Props for the CharacterCard component.
 * Displays character information including name, avatar, race/class/level.
 */
type Props = {
  /** The character's display name */
  name: string;
  /** URL to the character's avatar image */
  avatarUrl?: string;
  /** The character's race */
  race?: string;
  /** The character's class */
  characterClass?: string;
};

const { name, avatarUrl, race, characterClass }: Props = $props();
</script>
```

---

## 3. Service Architecture

### NEVER use Svelte stores

All state must be contained within services. Never create files in `src/lib/stores/`.

### Service File Structure

All services must follow this exact pattern:

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
	getCharacter(options: { id: string }): Promise<Character | null>;
};

class CharacterService
	extends BaseFrontendClass<CharacterServiceOptions>
	implements CharacterServiceInterface
{
	characters: Character[] = $state([]);

	async getCharacter(options: { id: string }): Promise<Character | null> {
		this.debug('getCharacter', options);
		return await characterRepository.getDocument(options);
	}
}

export const characterService: CharacterServiceInterface = new CharacterService(
	{
		className: "CharacterService",
	},
);
```

**Important**: Pass options when creating the singleton, not in the constructor.

**Rules**:
1. All methods use options object even for single arguments
2. All methods include `this.debug()` call at the start

---

## 4. ViewModel-View Pattern

Views should be passive and delegate all logic to the view model:

### ❌ WRONG

```typescript
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
```

### ✅ CORRECT

```typescript
<script lang="ts">
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.showGreeting}
    <CharacterCard ... />
  {/if}
  <ChatContainer onSend={(text) => viewModel.sendMessage(text)} />
</BaseViewModelContainer>
```

### Destructuring Reactive Properties

**NEVER** destructure properties from a ViewModel or Service. Destructuring evaluates getters and `$state` immediately, copying the static value and completely breaking Svelte 5's reactivity tracking.

### ❌ WRONG: Destructuring (Breaks Reactivity)

```typescript
<script lang="ts">
  const viewModel = getAppViewModel({ data, className: 'AppViewModel' });

  // BAD! This copies the values once and breaks Svelte's signal tracking
  const { showAppBar, isLoggedIn } = viewModel;
</script>

{#if showAppBar}
  <AppBar />
{/if}
```

### ✅ CORRECT: Direct Instance Access

Always access properties directly through the viewModel instance in your template. This ensures Svelte's compiler registers the property read and successfully tracks the signal.

```typescript
<script lang="ts">
  const viewModel = getAppViewModel({ data, className: 'AppViewModel' });
</script>

{#if viewModel.showAppBar}
  <AppBar />
{/if}
```

The view model should:

- Handle initialization in `initialize()` method (called by BaseViewModelContainer)
- Expose all UI state as properties
- Expose all UI actions as methods

---

## 5. Interface Definition

All interfaces must have JSDoc comments:

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
	 * Currently selected character.
	 * @readonly - Use selectCharacter() to modify
	 */
	readonly selectedCharacter: Character | null;

	/**
	 * Imports a character from a file.
	 * @param options - Configuration object.
	 * @param options.file - The file to import.
	 * @returns The imported Character or null if import failed.
	 */
	importFile(options: { file: File }): Promise<Character | null>;
};
```

**Rules:**

1. Always use `readonly` for state properties
2. Use `@readonly` annotation
3. All fields must have JSDoc comments
4. All methods must have JSDoc with @param descriptions
5. All methods use options object even for single arguments

---

## 6. Path Aliases

Use path aliases defined in `svelte.config.js`:

| Alias       | Purpose               |
| ----------- | --------------------- |
| `$lib`      | lib folder            |
| `$types`    | @aikami/types         |
| `$services` | frontend services     |
| `$logger`   | @aikami/logger        |
| `$views`    | view models and views |
| `$i18n`     | i18n utilities        |

### Import Rules

- Use **explicit type imports**: `import type { Character } from '$types'`
- Use **named exports** over default exports
- **Always include file extensions** in relative imports:
    ```typescript
    import { something } from "./foo.ts";
    import { something } from "./bar.svelte.ts";
    ```

---

## 7. API Routes

All API endpoints use the `createApiHandler` pattern:

```typescript
import { createApiHandler } from "@aikami/utils";
import type { PWACalls } from "@aikami/types";

export const POST: RequestHandler = (event) =>
	createApiHandler<PWACalls, "feature">("feature", event, async (data) => {
		const { payload, type } = data;
		// Handle the request
		return { success: true };
	});
```

---

## 8. Error Handling

Use the **AppError** system:

```typescript
import { toAppError, toAppErrorFromUnknownError } from "@aikami/utils";

// Known error types
throw toAppError("not-found", "Resource not found");
throw toAppError("invalid-argument", "Invalid email");
throw toAppError("unauthorized", "User not logged in");
throw toAppError("internal", "Something went wrong", { extra: "data" });

// Handling unknown errors
try {
	await doSomething();
} catch (err) {
	const appError = toAppErrorFromUnknownError(err);
}
```

**Valid error types**: `cancelled`, `invalid-argument`, `deadline-exceeded`, `not-found`, `already-exists`, `permission-denied`, `resource-exhausted`, `failed-precondition`, `aborted`, `out-of-range`, `unimplemented`, `unavailable`, `unauthenticated`, `unknown`, `internal`, `data-loss`

---

## 9. Testing

### Unit Tests

Use Bun's built-in test runner:

```typescript
import { describe, expect, test } from "bun:test";

describe("CharacterService", () => {
	test("should import character from file", async () => {
		const character = await characterService.importFile(mockFile);
		expect(character).not.toBeNull();
	});
});
```

### E2E Tests

Use Playwright:

```typescript
import { expect, test } from "@playwright/test";

test.describe("Authentication", () => {
	test("should login successfully", async ({ page }) => {
		await page.goto("/login");
		await page.fill('[name="email"]', "test@example.com");
		await page.fill('[name="password"]', "password");
		await page.click('[type="submit"]');
		await expect(page).toHaveURL("/dashboard");
	});
});
```

---

## 10. Build & Development Commands

### Moon Tasks

```bash
# Development
bun moon run pwa:dev

# Build
bun moon run pwa:build

# Test
bun moon run pwa:test

# Lint & Fix
bun moon run pwa:lint
bun moon run pwa:fix

# Validate (typecheck + test)
bun moon run pwa:validate
```

### Direct Commands

```bash
# In project directory
cd apps/frontend/pwa

# Dev server
bun run dev

# Build
bun run build

# Run tests
bun run test

# Typecheck
bun run typecheck
```

---

## 11. Anti-Patterns to Avoid

1. ❌ Using Svelte stores (`writable`, `readable`) - Use services with `$state`
2. ❌ Adding local `$state` in views - All state belongs in view models
3. ❌ Using `onMount` for initialization - Use `initialize()` in view models
4. ❌ Adding local functions in views - Delegate to view model methods
5. ❌ Using `any` type - Use `unknown` and proper type guards
6. ❌ Using `as unknown as SomeType` - Create transformation functions instead
7. ❌ Omitting file extensions in imports
8. ❌ Using default exports - Use named exports
9. ❌ Destructuring reactive properties from ViewModels or Services - Always access them directly via the instance (`viewModel.property`) so Svelte tracks the read.
10. ❌ Using positional arguments - Always use options object, even for single arguments
