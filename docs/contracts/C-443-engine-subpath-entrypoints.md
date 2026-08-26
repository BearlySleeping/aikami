---
id: C-443
title: "Engine Subpath Entrypoints — sim / render / content, Enforced"
source: "user request 2026-08-26 — should we split up engine into engine-sim, engine-render, engine-content?"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-26"
---

# Contract C-443: Engine Subpath Entrypoints — sim / render / content, Enforced

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-26): *"should we split engine-sim (bitECS, systems, math, GOAP, pathfinding — zero pixi, runs in the worker and in node), engine-render (pixi, LPC compositing, tilemap chunks, texture manager), and engine-content? Or is it not needed?"* |
| **Target** | `packages/frontend/engine/package.json`, `packages/frontend/engine/src/index.ts`, new `src/sim.ts` / `src/render.ts` / `src/content.ts` barrels |
| **Priority** | P1 — the single barrel is the documented reason duplicate code exists in the client. Removing the reason prevents recurrence. |
| **Dependencies** | C-442 (deletes the mirrors this contract makes unnecessary). C-442 must merge first. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal → developer note on importing from the engine |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `packages/frontend/engine/src/index.ts` is a single
  ~450-line barrel that unconditionally re-exports ECS components, systems,
  math, GOAP, asset loaders, Pixi rendering, and the Pixi application. There is
  no `exports` field in `packages/frontend/engine/package.json` — only
  `"main": "src/index.ts"`.

- **Consequence, in the codebase's own words.**
  `apps/frontend/client/src/lib/data/lpc_models.ts` header:
  > *"We define them locally to avoid statically importing the full engine
  > bundle (which triggers INEFFECTIVE_DYNAMIC_IMPORT warnings in Vite/Rollup).
  > The engine is lazily loaded only when the game canvas is actually needed."*

  Importing a two-value numeric enum requires pulling a module graph containing
  `pixi.js`, `bitecs`, and `@tursodatabase/database`. The barrel itself carries
  two hand-written comments apologising for exactly this
  (`asset_manifest_node.ts` and `turso_registry_hydration.ts` are documented as
  *"intentionally NOT re-exported"*), which is a manual workaround for a missing
  entrypoint boundary.

- **The boundary is already ~90% real on disk.** `pixi.js` is imported by only
  13 non-test source files:
  ```bash
  rg -l "from 'pixi.js'" packages/frontend/engine/src --glob '!**/__tests__/**'
  ```
  → `assets/custom_scheme_url_resolver.ts`, `assets/manifest_atlas_resolver.ts`,
  `game_world.ts`, `pixi_app.ts`, `rendering/prop_texture_resolver.ts`,
  `rendering/scene_background.ts`, `rendering/sprite_composer.ts`,
  `rendering/texture_defaults.ts`, `rendering/texture_manager.ts`,
  `rendering/tilemap_chunk_renderer.ts`, `rendering/weather_overlay.ts`,
  `systems/render_system.ts`, `systems/tilemap_render_system.ts`.

  Everything under `components/`, `math/`, `serialization/`, and most of
  `systems/` is already Pixi-free.

- **Why three packages is the wrong answer.** Splitting into
  `engine-sim` / `engine-render` / `engine-content` requires resolving real
  cross-cutting edges that are currently harmless intra-package imports:
  `systems/render_system.ts` → `components/*`,
  `systems/entity_spawner.ts` → `assets/map_loader.ts`,
  `game_world.ts` → all three. That is a cyclic-dependency tax plus three
  `package.json`, three `tsconfig.json`, three `moon.yml`, and three typecheck
  tasks — paid to obtain a boundary that an `exports` map plus one test already
  provides.

- **Existing implementation to reuse**: the directory layout. No file needs to
  move except where a module sits on the wrong side of the line.

- **Known gaps**: nothing enforces the boundary; nothing declares it; consumers
  cannot express "I only need the pure part".

- **Baseline tests**: `bun test packages/frontend/engine/src/__tests__/` and
  `moon run client:build` — record the current largest chunk size for the
  performance AC.

## User Outcome

After this contract, a **developer** imports `@aikami/frontend/engine/sim` from
a Web Worker, a Node script, or a hub route and gets zero PixiJS in the module
graph — enforced by a test, not by convention — and never needs to hand-copy an
enum to keep a bundle small.

## Success Measures

- **Time/latency target**: `moon run engine:typecheck` does not regress by more
  than 10%.
- **Offline/degraded behavior**: N/A — build-time boundary only.
- **Production journey enabled**: the hub can consume engine sim/content logic
  without shipping a renderer to a Cloudflare Worker.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Public export surface | `packages/frontend/engine/src/index.ts` | **modify** — becomes the union of the three sub-barrels |
| Package manifest | `packages/frontend/engine/package.json` | **modify** — add `exports` map |
| Worker entry | `src/worker/ecs_worker.ts` | **reuse** — gains a declared `./worker` subpath |
| Node-only asset code | `src/assets/asset_manifest_node.ts` | **modify** — gains a declared `./node` subpath, replacing the "do not re-export" comment |
| Turso hydration | `src/persistence/turso_registry_hydration.ts` | **modify** — same, moves under `./node` |

## Overview

Add four sub-barrels — `src/sim.ts`, `src/render.ts`, `src/content.ts`,
`src/node.ts` — and an `exports` map in `package.json` that publishes them as
`./sim`, `./render`, `./content`, `./node`, `./worker`, and `.`. The root barrel
becomes the union of `sim + render + content`, so every existing import keeps
working. Add a test that walks the module graph from `./sim` and `./content` and
fails if `pixi.js` appears. Repoint the client's engine imports to the narrowest
subpath that satisfies them.

No engine source file changes behaviour. Files move only where they sit on the
wrong side of the line.

## Design Reference

- The two "intentionally NOT re-exported" comments in `src/index.ts` describe
  the boundary this contract formalises — delete them and point at `./node`.
- `packages/frontend/engine/tsconfig.json` already maps workspace packages via
  `paths`. Consumers resolving `@aikami/frontend/engine/sim` need a matching
  `paths` entry in each consuming app's tsconfig **and** a Vite alias where one
  exists — mirror how `@aikami/frontend/engine/worker/ecs_worker.ts` resolves
  today (see `apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view_model.svelte.ts:27`).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Membership rule, applied mechanically:**
  | Subpath | Contains | Forbidden imports |
  |---|---|---|
  | `./sim` | `components/`, `systems/` minus render systems, `math/`, `core/`, `config/`, `serialization/`, `state/` | `pixi.js` |
  | `./content` | `assets/` minus Pixi resolvers, `entities/` | `pixi.js`, `node:*` |
  | `./render` | `rendering/`, `systems/render_system.ts`, `systems/tilemap_render_system.ts`, `pixi_app.ts`, `assets/custom_scheme_url_resolver.ts`, `assets/manifest_atlas_resolver.ts`, `environment/` | `node:*` |
  | `./node` | `assets/asset_manifest_node.ts`, `persistence/turso_registry_hydration.ts` | — |
  | `./worker` | `worker/ecs_worker.ts`, `worker/ecs_worker_bootstrap.ts` | `pixi.js` |
  | `.` | union of `sim` + `render` + `content` | — |
- `game_world.ts` and `engine_bridge.ts` are orchestration and import from every
  side. They stay on the root barrel only — they are **not** exported from
  `./sim`, `./render`, or `./content`.
- **Move only where required.** If a module in `systems/` imports Pixi and is
  not a render system, do not force it into `./render` — split the Pixi-using
  function out. Record every such split in the PR description.
- No module may be exported from two subpaths. The root barrel re-exporting all
  three is the single exception.
- `AnimationController` (the class) stays in `./render` if it touches Pixi; its
  pure helpers already moved to `@aikami/lpc` in C-442.

## State & Data Models

N/A — no data model changes. The only new artifact is the `exports` map:

```jsonc
// packages/frontend/engine/package.json
{
  "name": "@aikami/frontend/engine",
  "main": "src/index.ts",
  "exports": {
    ".":          "./src/index.ts",
    "./sim":      "./src/sim.ts",
    "./render":   "./src/render.ts",
    "./content":  "./src/content.ts",
    "./node":     "./src/node.ts",
    "./worker":   "./src/worker/ecs_worker.ts",
    "./package.json": "./package.json"
  }
}
```

## Quality Requirements

- **Offline/degraded mode**: N/A — build-time only.
- **Accessibility/input**: N/A.
- **Performance budget**: the client's largest JS chunk must not grow. Record
  the pre-change size from `moon run client:build` and assert it in the PR.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: N/A.

## Migration & Rollback

N/A — no persistent state changes. The root barrel keeps its full surface, so
every existing import continues to resolve; rollback is a revert.

## Scope Boundaries

- **In Scope:**
  - Four new sub-barrels and the `exports` map.
  - `paths` + Vite alias wiring in `apps/frontend/client` and
    `apps/frontend/hub` so subpaths resolve.
  - The pixi-free boundary test.
  - Repointing client imports to the narrowest sufficient subpath.
  - Deleting the two "intentionally NOT re-exported" comments and the manual
    workaround they describe.
- **Out of Scope:**
  - **Splitting the engine into separate packages.** Explicitly rejected — see
    Problem & Baseline Evidence. Revisit only when a second deployable actually
    consumes `./sim` in isolation.
  - Any behaviour change in any system, component, or renderer.
  - Any new engine feature.
  - `lpc_renderer.ts` and the client's Pixi pipeline — C-445.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — a declared and enforced module boundary.
Landing the `exports` map without the enforcement test would leave the boundary
decorative, so they ship together.

## Acceptance Criteria

### AC-1: `./sim` and `./content` are Pixi-free, provably
**Given** the engine package
**When** the module graph is walked transitively from `src/sim.ts` and
`src/content.ts`
**Then** no reachable module imports `pixi.js`, and the test names the offending
import chain when it fails.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/engine/src/__tests__/entrypoint_boundary.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`

**Watch Points**:
- Walk the graph by parsing import statements from source, not by bundling —
  a bundler-based check is slow and hides `import type`. `import type` must be
  **allowed** (it is erased); a value import of `pixi.js` must fail.

---

### AC-2: Every existing import still resolves
**Given** the merged branch
**When** `moon check` runs across the whole monorepo
**Then** it passes with zero new errors, because the root barrel still exports
the union of all three subpaths.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `moon check` output attached to the PR | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon check`

**Watch Points**:
- Bun workspace resolution for a package named `@aikami/frontend/engine` (which
  contains a `/` in its name) may not honour an `exports` map the way a
  conventionally-named package does. **Verify this first** — if it does not,
  fall back to tsconfig `paths` + Vite `resolve.alias` for the subpaths and
  document that in the PR. The boundary test is the thing that must hold; the
  resolution mechanism is negotiable.

---

### AC-3: The worker imports only `./sim` and `./content`
**Given** `src/worker/ecs_worker.ts`
**When** its imports are inspected
**Then** every engine import resolves within `./sim` or `./content`, and the
built worker chunk contains no PixiJS.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/engine/src/__tests__/entrypoint_boundary.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: `moon run client:build` then grep the emitted worker chunk for
  a PixiJS marker string.

**Watch Points**:
- The worker already avoids Pixi in practice. This AC locks it in so a future
  edit cannot quietly pull the renderer into the simulation thread.

---

### AC-4: The client imports the narrowest subpath
**Given** the ~40 client modules importing `@aikami/frontend/engine`
**When** each is inspected
**Then** any module that needs only ECS/math/asset logic imports `./sim` or
`./content`, and the root barrel is imported only by modules that genuinely
need `GameWorld` or `EngineBridge`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `moon run client:build` chunk report | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- Integration: compare the largest-chunk size against the recorded baseline.

**Watch Points**:
- Do not chase a size win by moving something across the boundary. Correctness
  of membership beats chunk size; the size improvement is a side effect.

---

### AC-5: The "do not re-export" workarounds are gone
**Given** `packages/frontend/engine/src/index.ts`
**When** it is read
**Then** the two comment blocks explaining that `asset_manifest_node.ts` and
`turso_registry_hydration.ts` are intentionally not re-exported are replaced by
their presence on the declared `./node` subpath, and the modules that imported
them by deep path now import `@aikami/frontend/engine/node`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `packages/frontend/engine/src/__tests__/entrypoint_boundary.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: `rg -n "intentionally NOT re-exported" packages/frontend/engine`
  returns nothing.

**Watch Points**:
- `turso_registry_hydration.ts` dynamically imports `@tursodatabase/database`,
  which imports `node:module`. It must stay off `./sim` even though it contains
  no Pixi — `./node` is where it belongs.

## Implementation Sequence

1. **Phase 1 (Classify)** — enumerate every module under `src/` and assign it to
   exactly one subpath per the membership table. Write the classification into
   the PR description before writing code. Flag every module that resists
   classification; those are the only ones that may need splitting.
2. **Phase 2 (Barrels)** — create `src/sim.ts`, `src/render.ts`,
   `src/content.ts`, `src/node.ts`. Rewrite `src/index.ts` as their union plus
   `GameWorld` / `EngineBridge`. Add the `exports` map. Verify AC-2 resolution
   works before going further (see the AC-2 watch point).
3. **Phase 3 (Enforce)** — write the boundary test. Fix whatever it catches.
4. **Phase 4 (Consumers)** — repoint client and hub imports to the narrowest
   subpath. Delete the workaround comments.
5. **Phase 5 (Validation)** — `bun run fix && bun moon run :validate && bun run test`,
   then `moon run client:build` and compare chunk sizes.

## Edge Cases & Gotchas

- **`import './assets/custom_scheme_url_resolver.ts';`** is a bare side-effect
  import at the top of the current barrel that registers a Pixi asset resolver.
  It must move to `./render` and must **not** appear in `./sim` or `./content` —
  a side-effect import is easy to miss when reading an export list, and it pulls
  Pixi in silently.
- **`environment/environment_ubo.ts`** is named like sim code but produces a
  GPU uniform buffer. Classify by what it imports and who consumes it, not by
  its directory.
- **`systems/` is not homogeneous.** Most are sim; `render_system.ts` and
  `tilemap_render_system.ts` are render. Do not move the whole directory.
- **`INEFFECTIVE_DYNAMIC_IMPORT` is silenced** in
  `apps/frontend/client/vite.config.ts` (~line 163). Once C-442 and this
  contract land, re-enable it for the engine specifically and see whether it
  still fires. If it does, the boundary is incomplete.
- **Do not gold-plate the split.** If a module is ambiguous, put it on the root
  barrel and move on. The goal is that `./sim` and `./content` are provably
  clean — not that every module found a perfect home.

## Open Questions

Must be resolved before status becomes `approved`:

- Does Bun's workspace resolver honour an `exports` map for a package whose name
  contains a `/` (`@aikami/frontend/engine`)? Resolve empirically in Phase 2.
  If not, tsconfig `paths` + Vite alias is the accepted fallback and this
  question closes as answered, not as blocking.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
