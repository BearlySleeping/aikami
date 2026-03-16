---
name: code-standards
description: Code style standards, naming conventions, TypeScript rules, and logging guidelines for the Aikami project.
version: 1.0.0
author: Aikami Team
tags: ["code-style", "typescript", "naming", "logging", "conventions"]
---

# Code Standards

General coding standards and conventions for the Aikami project.

---

## General Rules

- All methods must be JSDoc commented
- All methods must use an options object: `{...}` even for single arguments
- Use `options` instead of `opts`
- Escape early (return early pattern)
- If a section can be a separate method, make it a separate method
- Never use `any` type - use `unknown` with proper type guards
- Never use `null` - prefer `undefined`
- Never use non-null assertion (`!`)
- Use arrow functions
- Use `type` over `interface` unless extending
- Options types only used in a single method should be defined inside that method, not exported

---

## Method Options Pattern

All methods must use an options object, even for single arguments:

```typescript
/**
 * Parses a character from a local file (PNG or JSON) without uploading assets.
 * @param options - Configuration object.
 * @param options.file - The local file to parse.
 * @returns A promise that resolves to the parsed Character object.
 */
importFile(options: { file: File }): Promise<Character>;
```

---

## Debug Logging

All service and view model methods must include debug logging:

```typescript
// In services/viewmodels (they extend BaseFrontendClass)
async importFile(options: { file: File }): Promise<Character> {
  this.debug('importFile', options);
  // ... method implementation
}

// For standalone functions
import { logger } from '$logger';

async function parseCharacter(options: { file: File }) {
  logger.debug('parseCharacter', options);
  // ... function implementation
}
```

---

## Code Style

- Never abbreviate variable names (`functionName` not `fnName`, `options` not `opts`)
- Always use braces for if/else statements, even single-line

---

## Formatting (Biome)

The project uses **Biome** with these settings (from `biome.json`):

| Setting | Value |
|---------|-------|
| Indent | 2 spaces |
| Line width | 100 characters |
| Quotes | Single for JS/TS, double for JSX |
| Trailing commas | All (es5) |
| Semicolons | Always |
| Arrow parentheses | Always |

Run formatting before committing:

```bash
bun moon run :fix
```

---

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `character-service.svelte.ts`, `auth.utils.ts` |
| Classes | PascalCase | `CharacterService`, `LoginViewModel` |
| Functions/variables | camelCase | `importFile`, `selectedCharacter` |
| Constants (true) | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Constants (readonly) | camelCase | `defaultTimeout` |
| Types/Interfaces | PascalCase + suffix | `CharacterType`, `UserInterface` |

---

## Imports

- Use **explicit type imports**: `import type { Character } from '$types'`
- Use **path aliases**:
  | Alias | Purpose |
  |-------|---------|
  | `$lib` | lib folder |
  | `$types` | @aikami/types |
  | `$services` | frontend services |
  | `$logger` | @aikami/logger |
- Group imports: external → internal → relative
- Use **named exports** over default exports
- **Always include file extensions** in relative imports:

```typescript
// Good
import { something } from './foo.ts';
import { something } from './bar.svelte.ts';

// Bad
import { something } from './foo';
```

---

## TypeScript

- Always use explicit return types for exported functions
- Use `unknown` over `any` - if `any` is needed, add a comment explaining why
- NEVER use `as unknown as SomeType` - this is a code smell

**If types don't match, fix the root cause or create a transformation function:**

```typescript
// Bad
const admin = user as unknown as AdminUser;

// Good
function toAdminUser(user: User): AdminUser {
  return {
    ...user,
    permissions: user.permissions ?? [],
    role: 'admin',
  };
}
const admin = toAdminUser(user);
```

- Prefer **Zod** for runtime validation (use schemas from `@aikami/schemas`)
- Use **interface** for object shapes that may be extended, **type** for unions/intersections

```typescript
import type { Character } from "$types";
import { z } from "zod";

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type Character = z.infer<typeof CharacterSchema>;
```

---

## Logging

Use the logger from `$logger`. Never use `@aikami/logger` directly.

### Environment-Specific Loggers

The `$logger` alias points to different implementations:

| Project Type | Path Alias Target |
|--------------|-------------------|
| Firebase Functions | `packages/logger/src/lib/logger-functions.ts` |
| SvelteKit (SSR) | `packages/logger/src/lib/svelte-kit.ts` |
| Frontend (Browser) | `packages/logger/src/lib/logger-browser.ts` |
| Backend (Node.js) | `packages/logger/src/lib/logger-functions.ts` |

### Usage

```typescript
import { logger } from '$logger';

logger.log('info message');
logger.debug('debug message');
logger.warn('warning message');
logger.error('error message', { extra: 'data' });
```

- Use `logger.debug` for detailed logging
- Keep logging professional and standard

### Build Notes

The build tools (esbuild via firestack) do **not** automatically resolve tsconfig path aliases. Configure aliases explicitly in build config:

- **Firebase Functions**: firestack build passes `tsconfig` to esbuild, may need explicit alias
- **Scripts**: Pass aliases via command line:
  ```bash
  bun --alias '$logger=packages/logger/src/lib/logger-functions.ts' run script.ts
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
}
```

**Valid error types**: `cancelled`, `invalid-argument`, `deadline-exceeded`, `not-found`, `already-exists`, `permission-denied`, `resource-exhausted`, `failed-precondition`, `aborted`, `out-of-range`, `unimplemented`, `unavailable`, `unauthenticated`, `unknown`, `internal`, `data-loss`

---

## Interface Definition

All interfaces for services, view models, and component props must have JSDoc comments:

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
   * @param options - Configuration object.
   * @param options.file - The file to import.
   * @returns The imported Character or null if import failed.
   */
  importFile(options: { file: File }): Promise<Character | null>;
};
```

**Rules:**
1. Always use `readonly` for state properties in interfaces
2. Use `@readonly` annotation to document direct assignment is prohibited
3. All fields must have JSDoc comments describing purpose
4. All methods must have JSDoc comments with @param descriptions
5. All methods use options object even for single arguments

---

## Anti-Patterns to Avoid

1. ❌ Using `any` type - Use `unknown` with type guards
2. ❌ Using `as unknown as SomeType` - Create transformation functions
3. ❌ Using `null` - Prefer `undefined`
4. ❌ Using non-null assertion (`!`) - Handle nullability properly
5. ❌ Abbreviating variable names - Use descriptive names
6. ❌ Omitting braces in if/else - Always use braces
7. ❌ Missing JSDoc on public methods
8. ❌ Using positional arguments for methods - Always use options objects
