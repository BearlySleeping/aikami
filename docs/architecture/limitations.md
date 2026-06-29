# Known Limitations & TODOs

Current limitations and future work for the Aikami project.

## Structural Limitations (Engine Boundary)

These are architectural constraints discovered during the PixiJS v8 + bitECS engine boundary research (C-016). They are not bugs — they are intentional design boundaries that all future code must respect.

### Svelte 5 Reactivity Boundary

- **No `$state` in game code**: PixiJS runs at 60fps via `requestAnimationFrame`. Any `$state` variable touched in the game loop triggers a full DOM re-render every frame — catastrophic for performance. The `EngineBridge` pattern (C-016) enforces this separation. All game code lives in `apps/frontend/client/src/lib/game/` — a pure imperative TypeScript zone with zero Svelte imports.
- **No `$derived` / `$effect` across the boundary**: Game state flows into Svelte only through bridge event handlers (`bridge.on('EVENT', handler)`). Svelte's reactivity primitives must never watch game-internal values.
- **Svelte update threshold**: Svelte 5 runes batch updates, but the PixiJS tick loop runs outside Svelte's scheduler. High-frequency tick data must not mutate `$state` runes directly or the microtask queue overflows (`ERR_SVELTE_TOO_MANY_UPDATES`). Bridge events are emitted at UI-relevant intervals (dialogue triggers, health changes) — not per-frame.

### Bridge Serialization Constraints

- All `GameCommand` and `GameEvent` payloads crossing the `EngineBridge` must be **plain serializable objects** (strings, numbers, booleans, arrays of primitives). No class instances, functions, PixiJS `Sprite`/`Container` references, or bitECS `World`/entity handles.
- The bridge between SvelteKit (Bun/Vite dev server) and Tauri's webview must not assume synchronous IPC. All `bridge.send()` and `bridge.emit()` calls are fire-and-forget; listeners receive events asynchronously.
- **No blocking the game loop**: Bridge message handlers on the Svelte side must not perform synchronous heavy work. Offload to `requestIdleCallback` or batch processing.

## Architecture Limitations

1. **No CI/CD pipeline** — No GitHub Actions workflow. All testing and deployment is local.
2. **No separate staging environment** — The development project (`aikami-dev`) serves as both local dev target and deployed staging. Production is `aikami-prod`.
3. **Pre-existing TS errors in schema tests** — `packages/shared/schemas` test files have 7 TypeScript errors (unused vars, strict null checks). Tests pass at runtime but `tsgo --noEmit` fails.
4. **Client accessibility warnings** — svelte-check reports 7 errors + 9 warnings, mostly a11y violations in chat components.
5. **Firebase config hardcoded** — `.env` template uses placeholder values; no automated Firebase project creation.
6. **No automated dependency updates** — Dependabot/Renovate not configured.
7. **Data Connect emulator cold start** — PostgreSQL instance starts from scratch on first `emulators:start`, may take 30-60 seconds. Port 5432 may conflict with local PostgreSQL instances.
8. **GraphQL query complexity** — Data Connect's PostgreSQL schema migration tooling is still maturing (public preview). Schema changes require running `firebase dataconnect:generate` and manual review.

## Feature Gaps

### Planned but Not Implemented

| Feature                             | Spec                              | Status                                 |
| ----------------------------------- | --------------------------------- | -------------------------------------- |
| Game Engine (PixiJS + bitECS)       | C-016 contract                    | Not started                            |
| EngineBridge typed message channel  | C-016 contract                    | Not started                            |
| Tauri v2 Desktop Export             | C-013 tooling setup               | Not started                            |
| Database Abstraction (Data Connect) | C-014 contract                    | Not started                            |
| AI Service Abstraction              | C-015 contract                    | Not started                            |
| TanStack DB + PowerSync client sync | Planned                           | Not started                            |
| Valibot client validation           | Planned                           | Not started                            |
| Group Chats                         | Multiple NPCs in one conversation | Zod schema exists, no UI               |
| Character Relationships             | Dynamic relationship tracking     | Schema exists, no logic                |
| Knowledge Graphs                    | Connected world knowledge         | Schema stubbed                         |
| Lorebook Integration                | World lore in chat context        | Schema exists, not wired               |
| Voice Synthesis (TTS)               | ElevenLabs integration            | gamejs tests exist, no Client integration |
| Image Generation                    | AI avatar creation                | Callable function exists, no UI flow   |
| NPC Forking                         | Copy/remix public NPCs            | Schema field exists, no UI             |
| NPC Expressions                     | Multiple avatar images per NPC    | Schema field exists, no UI             |

### Partially Implemented

| Feature        | What's done       | What's missing                           |
| -------------- | ----------------- | ---------------------------------------- |
| Chat           | Basic 1-on-1 chat | Streaming, message history, branching    |
| Personas       | CRUD + switching  | Import/export, persona sharing           |
| NPCs           | CRUD + visibility | Public marketplace, forking, expressions |
| World Building | World schema      | World creation UI, world-settings        |

### Deprecated

| Component                                     | Status         | Notes                                                                                                                                    |
| --------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| GodotJS Game Client (`apps/frontend/gamejs/`) | ⚠️ Deprecated  | Preserved for reference. Migration target: `client/src/lib/game/` (PixiJS v8 + bitECS, C-016). Will be archived after C-016 is complete. |
| Genkit AI Framework                           | Replaced       | Migrated to vendor-agnostic AiServiceInterface (C-015). Direct Genkit imports being refactored.                                          |
| Firestore NoSQL                               | Being migrated | Target: Firebase Data Connect (PostgreSQL) per C-014. Existing Firestore repositories remain operational during incremental migration.   |

## Test Coverage Gaps

- **No Client unit tests** — ViewModels, services, and components have zero unit test coverage
- **Functions tests minimal** — Only 1 test file covering 5 controllers
- **No visual regression** — Playwright screenshot comparison not configured
- **No performance tests** — No load or stress testing
- **No engine boundary tests** — EngineBridge, bitECS systems, and game world have no test coverage (C-016 will create these)

## Documentation Gaps

- Engine boundary pattern documented (C-017) but not yet implemented (C-016)
- API documentation not generated from code
- Data Connect security rules documentation minimal
- PowerSync sync protocol documentation not started

## TODO (High Priority)

1. Implement C-016: Game Engine Boundary (PixiJS v8 + bitECS + EngineBridge)
2. Implement C-014: Database Abstraction & Data Connect
3. Implement C-015: AI Service Abstraction
4. Set up Tauri v2 desktop export (C-013)
5. Fix schema test TypeScript errors
6. Add Client view model unit tests
7. Set up GitHub Actions CI pipeline

## TODO (Nice to Have)

1. Visual regression testing setup
2. Automated Firebase project bootstrap in setup script
3. Client Storybook integration
4. API documentation generation
5. Performance benchmarks
6. PowerSync + TanStack DB client integration
7. Valibot schema migration for client-side validation
