<!-- completed: 2026-07-06 -->
# Contract C-309: Swarm Control Pi Extension & Command Surface Wrapper

## Metadata

| Field | Value |
|---|---|
| **Source** | Conversational Swarm Orchestration Requirements |
| **Target** | .pi/extensions/swarm_control.ts — Conversational pipeline controller |
| **Priority** | P0 — Eliminates shell-command friction for executing swarm operations |
| **Dependencies** | C-300, C-306 |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview
Design and deploy a project-specific pi extension module at `.pi/extensions/swarm_control.ts`. This extension registers custom tool hooks within the pi coding agent harness using TypeBox parameter specifications. It wraps the `swarm_director.ts` execution engine, allowing developers to conversationalize pipeline dispatching, monitor active worker locks, and fetch scratchpad statuses directly within the terminal agent loop.

## Design Reference
Follow the tool registration mechanics, schema validations, and context management patterns implemented inside `.pi/extensions/herdr-orchestrator.ts`. Ensure all shell operations execute safely using the re-wrapped `pi.exec` abstractions rather than raw shell dependencies to guarantee Nix shell alignment.

## Architecture Directives
- Register a primary tool named `swarm_trigger_pipeline` that uses Bun subprocess execution parameters to launch the background director script asynchronously without blocking the parent execution thread.
- Register a secondary tool named `swarm_get_ledger_status` that queries the SQLite WAL scratchpad database to surface live statuses of the worker processes back to the model context window.
- Enforce strict output constraints: text feedback returned by tools must follow a terse, technical fragment style devoid of filler words or pleasantries.

## State & Data Models

```typescript
interface SwarmToolParameters {
    taskId: string;
    initialTaskDescription: string;
    forceModelTierSelection: "pro" | "flash" | "default";
}

interface LedgerReportEnvelope {
    activeTaskId: string;
    globalLockActive: boolean;
    workerStates: Array<{
        agentKey: string;
        status: string;
        lastSyncTimestamp: number;
    }>;
}
```

## Scope Boundaries
- **In Scope**: Registering pi custom tools via `ExtensionAPI`, TypeBox schema enforcement, background execution wrappers, reading from the SQLite coordination repository, and printing summary logs.
- **Out of Scope**: Writing individual component logic, altering git index operations, or managing local editor buffers.

## Acceptance Criteria

### AC-1: Conversational Pipeline Dispatching
**Given** The user has loaded the workspace environment containing the custom extension module.
**When** The model triggers the `swarm_trigger_pipeline` tool with a target task configuration.
**Then** It must dynamically assemble the background execution string, spawn the supervisor daemon under herdr tab isolation boundaries, and return a 1-line confirmation footprint tracking the session identifier.

**Test Hooks**:
- Moon Task: `bun test .pi/tests/swarm_control.test.ts`
- Integration: Verify tool listing inside the agent panel via the conversational panel options.
- E2E / Visual: N/A

### AC-2: Transactional Ledger Inspection
**Given** Active worker sub-agents are performing out-of-process validations across separate tabs.
**When** The agent invokes `swarm_get_ledger_status` to scan pipeline health.
**Then** The tool must perform a sub-10ms query against the local scratchpad tables, parse the live state vector arrays, and stream a condensed status report directly into the conversation history.

**Test Hooks**:
- Moon Task: `bun run scripts -- test:extension_ledger`
- Integration: N/A
- E2E / Visual: N/A

**Watch Points**:
- Long-lived watch or loop interactions must never run inline within the main execution loop thread as they freeze the agent loop. Always pass tasks to background herdr configurations.

## Implementation Sequence
1. **Phase 1 (Data/Logic)**: Build out TypeBox validation parameter models and define the custom tool envelope shapes.
2. **Phase 2 (Integration)**: Connect the extension code to the herdr orchestration runtime and wire database access lines.
3. **Phase 3 (Validation)**: Run system check passes using `validate()` to ensure zero compilation anomalies.

## Edge Cases & Gotchas
- **Nix Path Invalidation**: In some execution rings, rewrapped commands lose visibility of bin flags. Wrap script subprocess invocations within an explicit `direnv exec .` context envelope to preserve path inheritance stability.

---

## Execution Report — 2026-07-06

### Summary
Created pi extension at `.pi/extensions/swarm_control.ts` registering two tools: `swarm_trigger_pipeline` (launches swarm director in background herdr tab, TypeBox-validated params) and `swarm_get_ledger_status` (sub-10ms SQLite query into scratchpad heartbeat table, returns live worker states).

### AC Status
| AC | Status |
|----|--------|
| AC-1: Conversational Pipeline Dispatching | ✅ Implemented |
| AC-2: Transactional Ledger Inspection | ✅ Implemented |

### Files
| File | Change |
|------|--------|
| `.pi/extensions/swarm_control.ts` | Created — Two pi tools, TypeBox schemas, bun:sqlite ledger access, herdr subprocess spawning |

### Tests
```
✅ pi:fix        — Clean (16 files)
✅ pi:typecheck  — 0 errors
```

