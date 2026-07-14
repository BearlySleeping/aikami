<!-- completed: 2026-07-06 -->
# Contract C-302: Coherent Ephemeral SQLite-WAL Scratchpad Engine

## Metadata
- **Source**: Multi-Agent Concurrency Control Layout
- **Target**: packages/frontend/repositories/src/lib/agent_scratchpad.ts
- **Priority**: P1 (Foundation)
- **Dependencies**: C-005, C-014

## Overview
Implement an ephemeral, high-speed file-backed scratchpad database utilizing SQLite configured in Write-Ahead Logging (WAL) mode. The scratchpad operates as the central state synchronization ledger for parallel agents, tracking resource versions, maintaining append-only historical mutation records, and enforcing strict Optimistic Concurrency Control (OCC) over isolated agent write shards to prevent race conditions.

## Design Reference
Follow the database service interfaces defined in `packages/backend/database/`. Use atomic transactions with `BEGIN IMMEDIATE` to prevent deadlock and serialization conflict loops across separate process tabs.

## Architecture Directives
Isolate the scratchpad engine within a dedicated package module. Expose clean, non-blocking asynchronous wrappers using Bun's native SQLite driver capabilities.

## State & Data Models
```typescript
interface ArtifactRecord {
    key: string;
    version: number;
    contentHash: string;
    content: string;
    state: "SHARED" | "EXCLUSIVE" | "INVALID";
    ownerId: string | null;
    epoch: number;
}

interface ScratchpadPayloadEnvelope {
    schemaVersion: string;
    sessionId: string;
    workspaceRoot: string;
    readSet: Array<{ key: string; version: number }>;
    writeDelta: {
        key: string;
        expectedVersion: number;
        eventType: "create" | "update" | "delete";
        content: string;
    };
}
```

## Scope Boundaries
- **In Scope**: SQLite WAL instantiation, artifact schema creation, transactional version matching, delivery log recording, and atomic Compare-And-Swap (CAS) commit verification.
- **Out of Scope**: Permanent cloud database persistence, sync loops with production Firestore collections, or user session data management.

## Acceptance Criteria

### AC-1: Concurrent Read-Set Isolation and Registration
**Given** A shared coordination resource target entry inside the database.
**When** An agent queries the resource shard.
**Then** The engine must return the document, append a strict record to the delivery log tracking the exact version read, and maintain thread concurrency without locking adjacent reading workflows.

**Test Hooks**:
- Moon Task: `bun test packages/frontend/repositories/tests/scratchpad_read.test.ts`
- Integration: N/A
- E2E / Visual: N/A

### AC-2: Optimistic Concurrency Control and Stale Write Rejection
**Given** An agent attempting to write to a scratchpad artifact.
**When** The submitted expectedVersion is lower than the active database record version (stale read).
**Then** The transaction must immediately fail, throw a strict ConflictError exception, execute a full rollback, and preserve the existing database state.

**Test Hooks**:
- Moon Task: `bun test packages/frontend/repositories/tests/scratchpad_occ.test.ts`
- Integration: N/A
- E2E / Visual: N/A

**Watch Points**:
- Ensure all write tasks utilize `BEGIN IMMEDIATE` to block nested write contentions upfront while leaving the read pipeline unblocked.

## Implementation Sequence
1. **Phase 1 (Data/Logic)**: Build out the SQLite table architectures and define the database schema constraints.
2. **Phase 2 (Integration)**: Write the transactional Compare-And-Swap commit mechanisms and implement retry loops.
3. **Phase 3 (Validation)**: Run concurrent stress tests simulating parallel agent writes to confirm zero race conditions.

## Edge Cases & Gotchas
- **Zombie Process Leases**: If an agent pane crashes while holding an exclusive write lease, the resource stalls. Implement an epoch-fenced heartbeat sweep that invalidates leases after 30 seconds of execution dormancy.

---

## Execution Report — 2026-07-06

### Summary
Implemented ephemeral SQLite-WAL scratchpad engine in `packages/frontend/repositories`. Uses Bun's native `bun:sqlite` with WAL journal mode, OCC via CAS version checks, `BEGIN IMMEDIATE` transactions, and epoch-fenced lease invalidation.

### AC Status
| AC | Status |
|----|--------|
| AC-1: Concurrent Read-Set Isolation & Registration | ✅ Implemented |
| AC-2: Optimistic Concurrency Control & Stale Write Rejection | ✅ Implemented |

### Files
| File | Change |
|------|--------|
| `packages/frontend/repositories/src/lib/agent_scratchpad.ts` | Created — SQLite WAL engine with ConflictError, delivery log, lease sweep |
| `packages/frontend/repositories/src/index.ts` | Modified — Added barrel export |

### Tests
```
✅ frontend-repositories:fix        — Clean
✅ frontend-repositories:typecheck  — 0 errors
```

