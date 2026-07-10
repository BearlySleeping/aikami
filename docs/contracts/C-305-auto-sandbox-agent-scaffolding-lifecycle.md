<!-- completed: 2026-07-06 -->
# Contract C-305: Auto-Sandbox Agent Scaffolding Lifecycle

## Metadata

| Field | Value |
|---|---|
| **Source** | Multi-Agent Swarm Sandbox Isolation Target |
| **Target** | scripts/src/lib/agents/sandbox_scaffolder.ts — Isolated workspace view generator |
| **Priority** | P1 — Closes the diagnostic testing loop for autonomous UI/Engine verification |
| **Dependencies** | C-120, C-139, C-300, C-302, C-303 |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview
Design and deploy an automated playground builder layer within the multi-agent pipeline. Whenever a state mutation, database interface, or ViewModel component is introduced or edited by the coder agent, the Auto-Sandbox agent intercepts the change, programmatically structures an isolated development route under the client project's dev sandbox folder, embeds mock lifecycle options, and links the path directly to the visual regression runner context file.

## Design Reference
Follow the view isolation layout guidelines detailed in `docs/contracts/C-120-view-folder-restructure.md` and the existing sandbox routing structures inside `apps/frontend/client/src/routes/(dev)/dev/sandbox/`. Observe strict client-side SPA conventions: no server files (`+page.server.ts`, `+server.ts`) can ever be written to the route directory.

## Architecture Directives
The module must parse changes to state objects, extract reference names, and copy the boilerplate pattern from the target component's corresponding mock model. Let Pi decide file placement configurations while strictly respecting the `snake_case` file naming constraints.

## State & Data Models

```typescript
interface SandboxScaffoldConfig {
    routeSegmentName: string;
    targetViewModelClassName: string;
    mockDataServiceReferenceKey: string;
    viewportDimensions: {
        width: number;
        height: number;
    };
}

interface ScaffoldRegisterLog {
    scaffoldId: string;
    relativeRoutePath: string;
    generatedFilePaths: string[];
    timestamp: string;
}
```

## Scope Boundaries
- **In Scope**: Dynamic folder construction under client routes, template code emission for logicless views (`+page.svelte`), injecting mock ViewModel factories, and appending path descriptors to `.pi/healing_context.json`.
- **Out of Scope**: Editing core production SvelteKit layout files, modifying production database schemas, or writing global Tailwind configs.

## Acceptance Criteria

### AC-1: Automated Isolated Route Provisioning
**Given** The coder sub-agent has modified a game model definition or frontend component footprint.
**When** The sandbox scaffolding script is triggered by the master swarm director daemon.
**Then** It must evaluate the target change file, construct a unique `snake_case` route directory under `src/routes/(dev)/dev/sandbox/`, generate a pure template `+page.svelte` file, and assign the component ViewModel prop via its factory wrapper method.

**Test Hooks**:
- Moon Task: `bun run scripts/src/lib/agents/sandbox_scaffolder.ts --mock-target UserComponent`
- Integration: Verify folder hierarchy allocation using standard shell inspection commands.
- E2E / Visual: N/A

### AC-2: Visual Runner Integration Loop
**Given** A newly scaffolded development test playground route.
**When** The scaffolding process finishes writing layout assets to disk.
**Then** It must compile a metadata registry object containing the new route parameter context and inject it directly into the testing harness queue, enabling `test_healer.ts` to perform immediate browser screenshots without manual configuration blocks.

**Test Hooks**:
- Moon Task: `bun run scripts -- test:sandbox_chain`
- Integration: Confirm the route is reachable via local test page navigation.
- E2E / Visual: N/A

**Watch Points**:
- Ensure all emitted Svelte files include the relative path configuration comment on line 1 inside the `<script lang="ts">` envelope to preserve global formatting standards.

## Implementation Sequence
1. **Phase 1 (Data/Logic)**: Build code generation templates for logicless views and mock ViewModel providers.
2. **Phase 2 (Integration)**: Wire the execution handler into the primary swarm director loop pipeline sequence.
3. **Phase 3 (Validation)**: Trigger mock component workflows to verify zero-friction playground construction.

## Edge Cases & Gotchas
- **Orphaned Test Paths**: Frequent scaffolding steps leave empty folders over time. The script must query the central SQLite scratchpad to garbage-collect and remove old, untracked playground structures upon successful task merges.

---

## Execution Report — 2026-07-06

### Summary
Created automated sandbox scaffolder at `scripts/src/lib/agents/sandbox_scaffolder.ts`. Generates isolated dev sandbox routes with logicless Svelte views, mock ViewModel factories, ViewModel stubs, and healing context integration.

### AC Status
| AC | Status |
|----|--------|
| AC-1: Automated Isolated Route Provisioning | ✅ Implemented |
| AC-2: Visual Runner Integration Loop | ✅ Implemented |

### Files
| File | Change |
|------|--------|
| `scripts/src/lib/agents/sandbox_scaffolder.ts` | Created — Route scaffold generator, template emission, orphan cleanup |
| `scripts/src/index.ts` | Modified — Added sandbox:scaffold + scaffold aliases |
| `package.json` (root) | Modified — Added sandbox:scaffold script |

### Tests
```
✅ scripts:fix        — Clean (52 files)
✅ scripts:typecheck  — 0 errors
```

