# Known Limitations & TODOs

Current limitations and future work for the Aikami project. Refreshed during the
2026-09 documentation pass; entries whose exact counts were last observed in
July 2026 are marked and should be re-measured before being quoted.

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

1. **Cloud config is manual** — D1 database ids and R2 bucket names are filled into `wrangler.jsonc` by hand; there is no automated provisioning wizard.
2. **Pre-existing TS errors in schema tests** *(count last observed 2026-07)* — `packages/shared/schemas` test files had TypeScript errors (unused vars, strict null checks). Re-measure with the project's typecheck task before quoting this.
3. **Client accessibility warnings** *(count last observed 2026-07)* — svelte-check previously reported a11y issues in chat components.
4. **No automated dependency updates** — Dependabot/Renovate not configured.
5. **Turso local DB lifecycle** — the embedded libSQL store is initialized by `LocalDatabaseFactory` at boot; schema changes must remain compatible with existing local saves (migration strategy tracked under C-321).
6. **No cross-origin isolation (no SharedArrayBuffer)** — the web client deliberately serves `COOP: same-origin-allow-popups` and **no COEP**, so cross-origin isolation is off everywhere. This is required for OAuth popup sign-in (strict COOP severs the popup opener). All SAB-dependent code (engine zero-copy buffers, sqlite OPFS, Kokoro streaming pipeline) was removed; graceful fallbacks are in place. See [Cross-Origin Isolation — Gotchas & Lessons Learned](../guides/cross-origin-isolation.md).

## Feature Gaps

This document deliberately does **not** keep a feature-status matrix: it went
stale quickly and duplicated the contract tracker. For current state use:

- [`../contracts/PROGRESS.md`](../contracts/PROGRESS.md) — per-contract status.
- [`../contracts/PROMOTION.md`](../contracts/PROMOTION.md) — promotion state.
- [`../TODO.md`](../TODO.md) — outstanding, not-yet-drafted work.
- [`../design/`](../design/) — product/UX specifications.
- [`../guides/FEATURES.md`](../guides/FEATURES.md) — feature data shapes.

The July 2026 (pre-`C-400`) feature-gap and partial-implementation tables were
removed because most of their rows have since shipped; Git history has them.

## Test Coverage Gaps

*(Last assessed 2026-07 — re-measure before quoting.)* Playwright visual
regression and load/stress testing are not configured; EngineBridge and full ECS
system coverage is incomplete. The current strategy and layers live in
[`../guides/TESTING.md`](../guides/TESTING.md).

## Documentation Gaps

- API documentation is not generated from code.
- Turso sync / backup-restore documentation is minimal.

## Architectural Constraints (Critical — Must Enforce)

These constraints were identified in the July 2026 architecture review. Violating any of them causes runtime failures.

### Turso / Local Persistence Boundary

Turso (libSQL) is the local source of truth (C-321). Rules:

- All campaign/save/chat reads and writes go through the storage adapters in `packages/frontend/storage` (`TursoStorageAdapter`, `LocalDatabaseFactory`) — never raw IndexedDB or a direct cloud call for campaign data.
- IndexedDB is reserved for session recovery and chat drafts only.
- The game must boot, play, and save with zero network and no sign-in (directive #3).

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

### Data Connect GraphQL Field Naming *(historical)*

> Firebase Data Connect was removed from the codebase in C-385. This entry is
> kept because `scripts/src/lib/ops/validate_gql_fields.ts` still runs.

SQL Connect reserved the underscore character (`_`) in GraphQL field names for internal relationship compilers and helper queries. **GraphQL field names must use camelCase only.** Column-level names via `@col(name: "snake_case")` were unaffected — only the GraphQL schema type field names were restricted.

### 2xx on Business Failures (Sync Queues)

If a future sync queue rejects server-side business validation (e.g. insufficient gold for a purchase), the backend should respond with a 2xx success status and carry the error in the response body. Responding with a 4xx can jam an upload queue and block all subsequent sync operations. This only matters once an embedded-replica sync path is wired end-to-end.

### Cross-Origin Isolation (COOP/COEP) — Do Not Re-enable

The web client must stay **non-cross-origin-isolated**: `COOP: same-origin-allow-popups` and **no COEP** (headers are set by the client Worker). Rules:

- **Never set `Cross-Origin-Embedder-Policy: require-corp`** on the client — it provides zero isolation benefit without strict COOP and only blocks cross-origin subresources (e.g. Google avatar images).
- **Never set `COOP: same-origin` (strict)** on the client — it severs `window.opener` on the cross-origin OAuth handler popup, breaking Google sign-in.
- **No header combination yields both popup sign-in and SharedArrayBuffer** — Chrome only grants `crossOriginIsolated` with strict `same-origin` COOP. If SharedArrayBuffer is ever needed again, sign-in must use the redirect flow (no popup).
- **Do not reintroduce `SharedArrayBuffer` / `Atomics` / `crossOriginIsolated`-gated code** in the client or engine — it is dead weight that throws at runtime (`SharedArrayBuffer is not defined`) wherever isolation is off. The Tauri desktop build never had SAB either (WebKitGTK/WKWebView don't implement it).

## Observed MVP Defects (playthrough 2026-08-16)

Confirmed by a full walkthrough of the Emberwatch slice. Full analysis in
`docs/reference/mvp-assessment-2026-08-16.md` §6; specifications in
`docs/contracts/MVP_BACKLOG.md`.

| Defect | Severity | Contract |
|---|---|---|
| Production dialogue does **not** stream — `npc_dialogue_service.svelte.ts:795` claims it does, but `NpcDialogueTextGenerator` (line 96) has no `onChunk`. Skill checks compound it with a second non-streamed call (line 1373) | P0 | C-401 |
| Player soft-locks when an NPC walks into them — two-way collision blocking with no resolution rule (`entity_spawner.ts:112-115`) | P0 | C-402 |
| `/setup` world-generation output is discarded; the MVP loads Emberwatch regardless | P0 | C-405 |
| Equipment changes do not update the player's LPC sprite | P1 | C-403 |
| Maps near-unreadable at default night ambient | P1 | C-404 |
| `/capability` reports providers as `detected` when they are not (`capability_view_model.svelte.ts:103`) | P1 | C-406 |
| Dialogue choices overflow into a horizontal scrollbar, hiding valid actions | P1 | C-407 |
| Persona creation redirects to `/dev` for LPC preview | P1 | C-408 |
| 47 `(dev)` routes ship to production — `routes/(dev)/+layout.svelte` has no guard | P2 | C-410 |

### Known dead code

*(Last assessed 2026-08; re-check before acting.)*

- `packages/frontend/dataconnect` and `packages/frontend/firestore` were empty
  directories referenced from `tsconfig.json` files. They have since been
  removed (C-436, implemented).
- The `appearanceLayers` builder was duplicated between
  `game_boot_service.svelte.ts` and `game_engine_service.svelte.ts`; the
  consolidation contract (C-411) was merged into the C-418 batch.

## Outstanding work

The P0 MVP block (C-400, C-401, C-402, C-405) landed, as did most of the items
that used to be listed here. Do not maintain a task list in this file — it is
duplicated and drifts. Outstanding work lives in:

1. [`../TODO.md`](../TODO.md) — structured, contract-sized seeds.
2. [`../contracts/PROGRESS.md`](../contracts/PROGRESS.md) — contracts in flight.
3. [`../plans/`](../plans/) — active initiatives.

Still-valid ideas from the old list that are not yet contracts: automated
Cloudflare resource bootstrap in the setup script, Client Storybook, API
documentation generation, and performance benchmarks. Promote them to
`TODO.md` when they are ready to scope.

## TODO (Nice to Have)

1. Visual regression testing setup
2. Automated Cloudflare resource bootstrap (D1 + R2 provisioning) in the setup script
3. Client Storybook integration
4. API documentation generation
5. Performance benchmarks
