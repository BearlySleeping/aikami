# Known Limitations & TODOs

Current limitations and future work for the Aikami project.

## Structural Limitations (Engine Boundary)

These are architectural constraints discovered during the PixiJS v8 + bitECS engine boundary research (C-016). They are not bugs — they are intentional design boundaries that all future code must respect.

### Svelte 5 Reactivity Boundary

- **No `$state` in game code**: PixiJS runs at 60fps via `requestAnimationFrame`. Any `$state` variable touched in the game loop triggers a full DOM re-render every frame — catastrophic for performance. The `EngineBridge` pattern (C-016) enforces this separation. All game code lives in `packages/frontend/engine` — a pure imperative TypeScript zone with zero Svelte imports.
- **No `$derived` / `$effect` across the boundary**: Game state flows into Svelte only through bridge event handlers (`bridge.on('EVENT', handler)`). Svelte's reactivity primitives must never watch game-internal values.
- **Svelte update threshold**: Svelte 5 runes batch updates, but the PixiJS tick loop runs outside Svelte's scheduler. High-frequency tick data must not mutate `$state` runes directly or the microtask queue overflows (`ERR_SVELTE_TOO_MANY_UPDATES`). Bridge events are emitted at UI-relevant intervals (dialogue triggers, health changes) — not per-frame.

### Bridge Serialization Constraints

- All `GameCommand` and `GameEvent` payloads crossing the `EngineBridge` must be **plain serializable objects** (strings, numbers, booleans, arrays of primitives). No class instances, functions, PixiJS `Sprite`/`Container` references, or bitECS `World`/entity handles.
- The bridge between SvelteKit (Bun/Vite dev server) and Tauri's webview must not assume synchronous IPC. All `bridge.send()` and `bridge.emit()` calls are fire-and-forget; listeners receive events asynchronously.
- **No blocking the game loop**: Bridge message handlers on the Svelte side must not perform synchronous heavy work. Offload to `requestIdleCallback` or batch processing.

## Architecture Limitations

1. **Staging/production parity** — `aikami-staging` serves as the deployed staging project; production is `aikami-production`. Local development runs against emulators via direnv mode switching.
2. **Pre-existing TS errors in schema tests** — `packages/shared/schemas` test files have 7 TypeScript errors (unused vars, strict null checks). Tests pass at runtime but `tsgo --noEmit` fails.
3. **Client accessibility warnings** — svelte-check reports 7 errors + 9 warnings, mostly a11y violations in chat components.
4. **Firebase config hardcoded** — `.env` template uses placeholder values; no automated Firebase project creation.
5. **No automated dependency updates** — Dependabot/Renovate not configured.
6. **Turso local DB lifecycle** — the embedded libSQL store is initialized by `LocalDatabaseFactory` at boot; schema changes must remain compatible with existing local saves (migration strategy tracked under C-321).

## Feature Gaps

### Planned but Not Implemented

| Feature                             | Spec                              | Status                                    |
| ----------------------------------- | --------------------------------- | ----------------------------------------- |
| Authored offline vertical slice      | Product goal (see TODO.md)        | In progress — the immediate focus         |
| Turso embedded-replica cloud sync    | C-357                              | Not started (default sync path when enabled) |
| Group Chats                         | Multiple NPCs in one conversation | Schema exists, no UI                      |
| Character Relationships             | Dynamic relationship tracking     | Schema exists, no logic                   |
| Knowledge Graphs                    | Connected world knowledge         | Schema stubbed                            |
| Lorebook Integration                | World lore in chat context        | Schema exists, not wired                  |
| Voice Synthesis (TTS)               | Kokoro microservice                | Microservice runs locally; Client integration partial |
| Image Generation                    | ComfyUI microservice               | Microservice runs locally; UI flow partial |
| NPC Forking                         | Copy/remix public NPCs            | Schema field exists, no UI                |
| NPC Expressions                     | Multiple avatar images per NPC    | Schema field exists, no UI                |

### Partially Implemented

| Feature        | What's done       | What's missing                           |
| -------------- | ----------------- | ---------------------------------------- |
| Chat           | Basic 1-on-1 chat | Streaming, message history, branching    |
| Personas       | CRUD + switching  | Import/export, persona sharing           |
| NPCs           | CRUD + visibility | Public marketplace, forking, expressions |
| World Building | World schema      | World creation UI, world-settings        |

## Test Coverage Gaps

- **No Client unit tests** — ViewModels, services, and components have zero unit test coverage
- **Functions tests minimal** — Only 1 test file covering 5 controllers
- **No visual regression** — Playwright screenshot comparison not configured
- **No performance tests** — No load or stress testing
- **Engine boundary tests partial** — `packages/frontend/engine` has unit tests (e.g. `string_registry.test.ts`), but EngineBridge and full ECS system coverage is incomplete

## Documentation Gaps

- API documentation not generated from code
- Turso sync / backup-restore documentation minimal (C-357 embedded-replica sync)
- Firestore security rules documentation minimal

## Architectural Constraints (Critical — Must Enforce)

These constraints were identified in the July 2026 architecture review. Violating any of them causes runtime failures.

### Turso / Local Persistence Boundary

Turso (libSQL) is the local source of truth (C-321). Rules:

- All campaign/save/chat reads and writes go through the storage adapters in `packages/frontend/repositories` (`TursoStorageAdapter`, `LocalDatabaseFactory`) — never raw IndexedDB or direct Firestore calls for campaign data.
- IndexedDB is reserved for session recovery and chat drafts only.
- The game must boot, play, and save with zero network and no Firebase sign-in (directive #3).

### PixiJS v8 WebGPU Shader Reflection Bug

PixiJS v8's internal shader reflection utility (`extractAttributesFromGpuProgram.ts`) contains a regex bug: if a WGSL vertex shader input attribute is declared immediately before a closing parenthesis without trailing whitespace, the regex parser fails, causing a WebGPU validation crash.

```wgsl
// ❌ CRASHES the rendering pipeline:
fn mainVert(@location(0) aPosition: vec2f, @location(1) aUV: vec2f)

// ✅ Fixes the reflection parser:
fn mainVert(@location(0) aPosition: vec2f, @location(1) aUV: vec2f )
```

All `.wgsl` shader files must have trailing whitespace before closing parentheses in attribute lists.
A validation script (`scripts/src/lib/ops/validate_wgsl.ts`) enforces this at build time.

### Data Connect GraphQL Field Naming

SQL Connect (Firebase Data Connect) reserves the underscore character (`_`) in GraphQL field names for internal relationship compilers and helper queries. **GraphQL field names must use camelCase only.** Column-level names via `@col(name: "snake_case")` are unaffected — only the GraphQL schema type field names are restricted.

A validation script (`scripts/src/lib/ops/validate_gql_fields.ts`) enforces this.

### 2xx on Business Failures (Sync Queues)

If a future sync queue rejects server-side business validation (e.g. insufficient gold for a purchase), the backend should respond with a 2xx success status and carry the error in the response body. Responding with a 4xx can jam an upload queue and block all subsequent sync operations. This only matters once the Turso embedded-replica sync (C-357) is wired end-to-end.

## TODO (High Priority)

1. Build the authored 10–20 minute offline vertical slice
2. Fix schema test TypeScript errors
3. Add Client view model unit tests
4. Add engine boundary (EngineBridge) tests
5. Turso embedded-replica cloud sync (C-357)

## TODO (Nice to Have)

1. Visual regression testing setup
2. Automated Firebase project bootstrap in setup script
3. Client Storybook integration
4. API documentation generation
5. Performance benchmarks
