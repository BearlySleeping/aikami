---
name: aikami-standards
description: Strict coding guidelines, import orders, and class structures for Aikami.
---

# Aikami Coding Standards

When writing or modifying code in the Aikami monorepo, you MUST adhere to the following strict guidelines to ensure a DRY, single source of truth, and robust architecture.

## 1. Biome Compliance
- The codebase uses **BiomeJS** for formatting and linting.
- You must write code that passes `bunx biome check .` without errors.
- Do NOT use `any` (`noExplicitAny` is strictly enforced). Use `unknown` if a type is truly unknown, or properly type it via a TypeBox schema in `@aikami/schemas` (Zod is banned — see `aikami-conventions`).
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

Additional rules (see `aikami-conventions` for full detail):
- Private members use the `_` prefix (`private readonly _config`).
- All methods are **regular methods**, never arrow-function fields — `this`
  and `super` must work, and `create()` auto-logging only sees prototype methods.
- Classes extending `BaseClass`/`BaseViewModel` are instantiated via
  `ClassName.create({ className: '...' })`, never `new`.
- Use inherited `this.debug()` / `this.error()` for logging inside classes.

```typescript
export class ExampleService extends BaseClass implements ExampleServiceInterface {
  // 1. Static Fields
  private static _instanceCount = 0;

  // 2. Instance Fields
  private readonly _cache = new Map<string, State>();
  state: State = 'initialized';

  // 3. Public Methods
  async initialize(): Promise<void> {
    await this._setupDatabase();
  }

  // 4. Private Methods
  private async _setupDatabase(): Promise<void> {
    // ...
  }
}

export const exampleService: ExampleServiceInterface = ExampleService.create({
  className: 'ExampleService',
});
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
- Do not duplicate schemas. TypeBox schemas go in `packages/shared/schemas`; types are derived via `Static<typeof Schema>` and re-exported from `packages/shared/types`. Never hand-write a type that already has a schema.

## 6. Cross-Origin Isolation & Web Workers
When using `SharedArrayBuffer` for Web Workers, the document MUST be cross-origin isolated by returning `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. 
**CRITICAL LIMITATION**: SvelteKit's `adapter-static` combined with `vite preview` or production servers often bypass Vite's standard `preview.headers` configuration for static JS chunks.
- If a Web Worker script chunk lacks the `COEP` header, the browser will silently abort the worker execution (resulting in an empty `ErrorEvent` with no message) under `ERR_BLOCKED_BY_RESPONSE`.
- **Solution**: Always use a global middleware plugin in `vite.config.ts` (using `configureServer` and `configurePreviewServer`) to explicitly force the COOP/COEP headers on *all* responses.
- When dynamically importing a worker via `?worker`, ensure you set `worker: { format: 'es' }` in `vite.config.ts` so that it bundles cleanly as an ES Module instead of falling back to an IIFE that might violate strict isolation contexts.
