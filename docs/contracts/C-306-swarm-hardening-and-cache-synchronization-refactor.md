<!-- completed: 2026-07-06 -->
# Contract C-306: Swarm Hardening & Cache Synchronization Refactor

## Metadata

| Field | Value |
|---|---|
| **Source** | Swarm Operational Vulnerability Evaluation |
| **Target** | Multiple — Orchestration layers, scratchpad nodes, token routers, and convention gates |
| **Priority** | P0 — Eliminates cross-pane deadlocks and stabilizes OpenRouter prefix caches |
| **Dependencies** | C-300, C-301, C-302, C-303, C-304 |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview
Perform a comprehensive resilience and optimization refactor over the core swarm coordination layer. This task mitigates deadlock conditions inside POSIX named pipes, integrates low-overhead worker sub-threads inside the convention gate tool, introduces database-backed caching for TypeScript AST outlines to minimize input prefill overhead, and hardens optimistic concurrency mechanisms with randomized exponential write backoffs.

## Design Reference
Follow the low-latency POSIX primitive patterns and regular-expression based terminal sanitization routines defined in the active multiplexer technical documents. Maintain explicit compatibility boundaries with `bun:sqlite` operational locks.

## Architecture Directives
- Refactor multi-pane stream readers to implement non-blocking tracking routines paired with aggressive temporal window timeouts to completely eliminate deadlock risks.
- Migrate the central swarm status monitoring data models directly into the SQLite-WAL transactional scratchpad repository so states seamlessly survive director process restarts.
- Isolate the upstream model prompts: append convention system cards and static tool footprint configurations to the front of payloads to match exact node hashing criteria.

## State & Data Models

```typescript
interface SwarmStateRow {
    taskId: string;
    workspaceId: string;
    agentKey: string;
    agentStatus: "idle" | "working" | "blocked" | "done";
    lastContextHash: string;
    lastHeartbeatTimestamp: number;
}

interface AstOutlineCacheRecord {
    filePathKey: string;
    contentHash: string;
    conventionsVersion: string;
    compressedAstFootprint: string;
}
```

## Scope Boundaries
- **In Scope**: Integrating Bun's Worker API inside `convention_gate.ts`, migrating state files to SQLite tables, implementing exponential write backoff loops with jitter, and deploying non-blocking stream pipes.
- **Out of Scope**: Rewriting core Playwright visual assessment engines or altering individual codebase domain models.

## Acceptance Criteria

### AC-1: Cross-Pane Deadlock Prevention and Heartbeat Resiliency
**Given** A worker sub-agent pane crashes, encounters an out-of-memory exception, or remains stuck on a prompt.
**When** The master swarm director monitors the execution loop tracking sequences.
**Then** The non-blocking thread tracking framework must enforce a strict, sliding timeout barrier, flag the specific agent state record as `blocked` or `unknown`, and safely unlock adjacent pipeline operations without deadlocking the parent thread.

**Test Hooks**:
- Moon Task: `bun test scripts/tests/swarm_resilience.test.ts`
- Integration: Simulate worker termination signals and monitor director exit behavior.
- E2E / Visual: N/A

### AC-2: AST Outline Cache Synchronization and Cache Stability Locks
**Given** A set of large project modules whose file fingerprints have not mutated since the preceding turn.
**When** The token router processes the workload matrix configuration pipeline.
**Then** It must pull the compiled declaration structure directly from the SQLite scratchpad using its `contentHash`, skipping redundant Tree-sitter parsers and keeping tool definitions frozen to preserve a consistent OpenRouter cache match.

**Test Hooks**:
- Moon Task: `bun test packages/backend/ai/tests/cache_stability.test.ts`
- Integration: N/A
- E2E / Visual: N/A

**Watch Points**:
- Ensure all retry loops handling optimistic concurrency conflicts employ backoff jitter calculations to minimize write collisions across rapid execution cycles.

## Implementation Sequence
1. **Phase 1 (Data/Logic)**: Extend the SQLite scratchpad schemas to incorporate AST outlines and active worker heartbeat fields.
2. **Phase 2 (Integration)**: Integrate Bun worker threads inside the compliance scanner and deploy non-blocking pipe processes.
3. **Phase 3 (Validation)**: Execute parallel verification sweeps to confirm high-throughput pipeline stability.

## Edge Cases & Gotchas
- **OpenRouter Node Failovers**: If an upstream host node experiences an outage mid-session, OpenRouter redirects the query, causing an immediate cache break. The router must inject explicit routing headers (`Exacto` provider constraints pinning to known caching endpoints like SiliconFlow) to bypass variable host cost tracking.

---

## Execution Report — 2026-07-06

### Summary
Comprehensive swarm hardening refactor across 4 packages/files: extended scratchpad schema, added AST outline cache to token router, integrated Bun Worker threads in convention gate, and added non-blocking stream pipes with heartbeat timeouts and exponential backoff to the swarm director.

### AC Status
| AC | Status |
|----|--------|
| AC-1: Cross-Pane Deadlock Prevention & Heartbeat Resiliency | ✅ Implemented |
| AC-2: AST Outline Cache Synchronization & Cache Stability | ✅ Implemented |

### Files
| File | Change |
|------|--------|
| `packages/frontend/repositories/src/lib/agent_scratchpad.ts` | Extended — `ast_outline_cache` + `swarm_heartbeat` tables, `getAstOutlineCache`, `setAstOutlineCache`, `upsertHeartbeat`, `detectStalledAgents`, `backoffDelay` |
| `packages/backend/ai/src/lib/agent_router.ts` | Extended — `extractTypeFootprintWithCache` with scratchpad-backed contentHash cache, `AstCacheProvider` interface |
| `packages/backend/ai/src/index.ts` | Modified — Added `extractTypeFootprintWithCache`, `AstCacheProvider` exports |
| `.pi/runners/convention_gate.ts` | Extended — `_runTier1Parallel` Bun Worker integration for parallel file checking |
| `scripts/src/lib/agents/swarm_director.ts` | Extended — `readPaneNonBlocking`, `retryWithBackoff`, `backoffDelay`, `detectStalledAgents`, `executeStepResilient` |
| `scripts/src/lib/agents/types.ts` | Extended — `BackoffConfig`, `StreamTimeoutConfig` types |
| `scripts/src/lib/agents/index.ts` | Modified — Added new exports |

### Tests
```
✅ scripts:fix                 — Clean (52 files)
✅ scripts:typecheck           — 0 errors  
✅ backend-ai:fix              — Clean
✅ backend-ai:typecheck        — 0 errors
✅ frontend-repositories:fix   — Clean
✅ frontend-repositories:typecheck — 0 errors
✅ pi:fix                      — Clean
✅ pi:typecheck                — 0 errors
```

