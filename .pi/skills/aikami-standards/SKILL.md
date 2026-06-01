---
name: aikami-standards
description: Strict coding guidelines, import orders, and class structures for Aikami.
---

# Aikami Coding Standards

When writing or modifying code in the Aikami monorepo, you MUST adhere to the following strict guidelines to ensure a DRY, single source of truth, and robust architecture.

## 1. Biome Compliance
- The codebase uses **BiomeJS** for formatting and linting.
- You must write code that passes `bunx biome check .` without errors.
- Do NOT use `any` (`noExplicitAny` is strictly enforced). Use `unknown` if a type is truly unknown, or properly type it using Zod/Typebox.
- Do NOT ignore unused variables. Remove them.

## 2. Imports and Dependencies
- **Path Resolution**: Never import using the raw package name like `@aikami/frontend-utils`. Always use the slashes path like `@aikami/frontend/utils`.
- **Import Order**: 
  1. Node/Bun built-ins (e.g., `node:fs`)
  2. External dependencies (e.g., `pixi.js`, `svelte`)
  3. Internal shared packages (e.g., `@aikami/types`)
  4. Absolute project paths (e.g., `$lib/...`)
  5. Relative paths (e.g., `./utils.ts`)
- Let Biome's `organizeImports` handle the sorting automatically where possible.

## 3. Class Structure
Whenever you write a class, you MUST organize its members in the following order:
1. **Static Fields**
2. **Instance Fields** (private first, then public)
3. **Constructor**
4. **Public Methods** (core API first, then getters/setters)
5. **Private / Protected Methods**

```typescript
export class ExampleService {
  // 1. Static Fields
  private static instanceCount = 0;

  // 2. Instance Fields
  private readonly config: Config;
  public state: State;

  // 3. Constructor
  constructor(config: Config) {
    this.config = config;
    this.state = 'initialized';
  }

  // 4. Public Methods
  public async initialize(): Promise<void> {
    await this.setupDatabase();
  }

  // 5. Private Methods
  private async setupDatabase(): Promise<void> {
    // ...
  }
}
```

## 4. JSDoc and Comments
- All exported classes, interfaces, and public methods must have a clear JSDoc comment.
- Do not state the obvious. Explain the *why*, not the *what*.
- Example:
```typescript
/**
 * Synchronizes the bitECS game state with the SvelteKit UI.
 * This runs on a separate worker thread to avoid blocking the main PixiJS loop.
 */
export class EngineBridge { ... }
```

## 5. Single Source of Truth
- Do not duplicate constants. If a constant is used in both frontend and backend, it belongs in `packages/shared/constants`.
- Do not duplicate schemas. Types and schemas go in `packages/shared/schemas` and `packages/shared/types`.
