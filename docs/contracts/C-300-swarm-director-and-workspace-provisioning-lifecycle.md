<!-- completed: 2026-07-06 -->
# Contract C-300: Swarm Director & Workspace Provisioning Lifecycle

## Metadata
- **Source**: User Multi-Agent Swarm Requirements
- **Target**: scripts/src/lib/agents/swarm_director.ts
- **Priority**: P0 (Blocking)
- **Dependencies**: C-003, C-007, C-013

## Overview
Establish a persistent, headless background swarm director daemon inside the scripts project. The director connects to the local herdr multiplexer socket to automatically spin up, map, and orchestrate four logical execution environments (architect, coder, qa, and git) within a persistent workspace named 'aikami-agents'. It manages the full job pipeline, tracks foreground process lifecycles, and evaluates step compliance to coordinate task delegation safely.

## Changes Detail
- **Create**: `scripts/src/lib/agents/swarm_director.ts` — Core daemon manager script
- **Create**: `.pi/runners/` — Directory tracking specialized worker script targets
- **Update**: `package.json` — Wire `bun swarm:start` shortcut target script

## Architecture Directives
- Implement the supervisor loop utilizing Bun's native process engines, running completely out-of-process from the user's primary terminal thread.
- Dynamically query herdr workspace list mappings before every compilation phase to recover from window modifications or closed tabs without losing task state.
- Strictly enforce state tracking requirements, mapping worker panes across four distinct semantic execution phases: blocked, working, done, and idle.

## State & Data Models
```typescript
export interface AgentRecord {
  tabId: string;
  paneId: string;
  status: "idle" | "working" | "blocked" | "done" | "unknown";
  lastHash: string | null;
}

export interface SwarmState {
  lastUpdated: string;
  activeTaskId: string | null;
  workspaceId: string | null;
  agents: {
    architect: AgentRecord;
    coder: AgentRecord;
    qa: AgentRecord;
    git: AgentRecord;
  };
}
```

## Scope Boundaries
- **In Scope**: Programmatic herdr CLI interaction, JSON array parsing, workspace and tab provisioning, sequential lifecycle tracking, and scrollback buffer analysis.
- **Out of Scope**: Writing individual code mutation logic, local developer workspace configurations, or editing active project source files.

## Acceptance Criteria

### AC-1: Swarm Workspace Initialization and Role Mapping
**Given** The herdr daemon is active on the local Unix domain socket path.
**When** The swarm director script is executed with a target task payload.
**Then** It must verify the existence of the `aikami-agents` workspace, provision missing role tabs, map physical PTY identifiers to the internal state schema, and write a confirmation log.

**Test Hooks**:
- Moon Task: `bun run scripts -- swarm:init`
- Integration: Validate workspace creation via `herdr workspace list`
- E2E / Visual: N/A

### AC-2: Asynchronous Step Execution and Scrollback Compliance Checks
**Given** A valid state record with mapped physical pane identifiers.
**When** An execution command is triggered inside a target sub-agent tab.
**Then** The director must update the logical status to `working`, poll console scrollbacks incrementally via herdr pane read, scan for distinct compliance signatures, and block downstream steps until preceding actions resolve.

**Test Hooks**:
- Moon Task: `bun run scripts -- test:swarm_step`
- Integration: Manual extraction of scrollback indicators via `herdr pane read`
- E2E / Visual: N/A

**Watch Points**:
- Ensure all herdr command responses are strictly parsed as JSON configurations rather than unstructured string blocks to prevent data mapping anomalies.

## Implementation Sequence
1. **Phase 1 (Data/Logic)**: Build out structural interfaces and create the central director daemon layout shell.
2. **Phase 2 (Integration)**: Wire in herdr command executors and construct the automatic role tab mapping logic.
3. **Phase 3 (Validation)**: Run full validation sweeps to confirm clean lifecycle transitions across step targets.

## Edge Cases & Gotchas
- **Dynamic Pane Re-ordering**: If a user splits or closes an active pane manually, herdr panel coordinates shift. The director must query live tab metadata before delivering prompt inputs to verify target boundaries.

---

## Execution Report — 2026-07-06

### Summary
Implemented the Swarm Director & Workspace Provisioning Lifecycle (C-300) in the scripts project. Created data models, core director daemon, CLI entry points, and wired into the root package.json and scripts runner.

### AC Status

| AC | Description | Status |
|----|-------------|--------|
| AC-1 | Swarm Workspace Initialization and Role Mapping | ✅ Implemented |
| AC-2 | Asynchronous Step Execution and Scrollback Compliance Checks | ✅ Implemented |

### Files Created

| File | Purpose |
|------|---------|
| `scripts/src/lib/agents/types.ts` | Data model types: AgentRecord, SwarmState, AgentRole, SwarmStep, TaskPayload, PollingConfig |
| `scripts/src/lib/agents/swarm_director.ts` | Core supervisor daemon: workspace/tab provisioning, step execution, scrollback polling, compliance signature matching |
| `scripts/src/lib/agents/swarm_init.ts` | AC-1 CLI entry point: `bun run scripts -- swarm:init` |
| `scripts/src/lib/agents/swarm_start.ts` | AC-2 CLI entry point: `bun run scripts -- swarm:start <payload.json>` |
| `scripts/src/lib/agents/index.ts` | Barrel exports for the agents module |
| `.pi/runners/README.md` | Documentation for runner directory |
| `.pi/runners/.gitkeep` | Ensures directory tracking |

### Files Modified

| File | Change |
|------|--------|
| `scripts/src/index.ts` | Added `swarm:init` and `swarm:start` to SCRIPT_MAP |
| `package.json` (root) | Added `swarm:init` and `swarm:start` scripts |
| `biome.json` | Added `scripts/src/lib/agents/**` to useNamingConvention override (herdr API snake_case) |

### Deviations

- **Logger**: Used `console` instead of `$logger` — the scripts project tsconfig does not configure `$logger` path alias; other scripts in the project use console directly and biome `noConsole` is disabled for scripts.
- **Herdr API shapes**: Local inline types for herdr JSON responses kept in `swarm_director.ts` (not imported from shared types) to avoid cross-module coupling with herdr session types; duplicated types use identical shapes as `session.ts` counterparts.

### Test Results

```
✅ scripts:fix       — Checked 51 files, no fixes applied
✅ scripts:typecheck — 0 errors
✅ scripts:build     — passed
✅ validate(test)    — 4 passed (pi, scripts)
```

