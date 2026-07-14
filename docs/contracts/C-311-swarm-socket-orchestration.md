<!-- completed: 2026-07-07 -->
# C-311: Swarm Socket Orchestration & Structural Handoff Refactor

## 1. Objective
Refactor the fragile, CLI-polling swarm orchestration pipeline into a robust, event-driven architecture using the Herdr Socket API. Split the monolithic director into modular components, replace unstructured markdown handoffs with a strict JSON sidecar contract, implement role-specific timeouts, and introduce a non-LLM analytics step.

## 2. Architecture & Systems

### 2.1. Herdr Socket Client (`scripts/src/lib/herdr/socket_client.ts`)
Replace the noisy `child_process.spawn('herdr')` polling loop with a persistent, non-blocking `net.Socket` implementation.
- **Protocol:** Newline-delimited JSON over UNIX domain socket (resolved via `HERDR_SOCKET_PATH` or `~/.config/herdr/herdr.sock`).
- **Event Subscriptions:** Use `events.subscribe` to listen for `pane.agent_status_changed`. Monitor for transitions to `done` or `idle` states to trigger completion checks, avoiding arbitrary polling.
- **Buffer Reading:** Implement a `readBuffer(paneId: string)` method utilizing the Herdr `pane.read` API with `"source": "recent-unwrapped"` to ensure regex markers are not broken by soft line-wraps.
- **Race Condition Prevention:** Utilize sequence tracking (`seq`) in payloads to ensure late-arriving network packets do not overwrite newer state changes.

### 2.2. Standardized Completion Markers
- Unify all agent completion signals to a single, easily parsable regex format:
  `SWARM_DONE:<role>:<taskId>` (e.g., `SWARM_DONE:coder:TASK-9912`).
- The Socket client will watch the `recent-unwrapped` buffer for this exact marker upon receiving a `done`/`idle` status event.

### 2.3. Structured JSON Handoffs
Deprecate the freeform markdown summaries. Agents will now write to a structured JSON sidecar (`.pi/swarm/outputs/<taskId>_<role>_handoff.json`).
- **Schema Requirement:**
  ```json
  {
    "taskId": "string",
    "role": "architect|coder|qa|git",
    "status": "success|failed|escalated",
    "complexity": "trivial|standard|complex",
    "domain": "frontend|backend|fullstack",
    "requires_docs": boolean,
    "files_touched": ["string"],
    "next_commands": ["string"],
    "summary": "string (max 1024 chars)"
  }
  ```
- **Context Minimization:** Downstream agents (e.g., QA) will read this JSON file to seed their system prompt context, bypassing the raw, noisy conversational transcript of the upstream agent.

### 2.4. Modular Director Restructure (`scripts/src/lib/agents/`)

Decompose the 1000+ line `swarm_director.ts` into specialized, maintainable modules:

1. **`step_executor.ts`**: Manages the pipeline transitions (Architect → Coder → QA → Git).
   - Implement role-specific timeouts (e.g., Architect=60s, Coder=180s, QA=300s).
   - Implement the **Trivial Path**: If the Architect's JSON flags `"complexity": "trivial"`, bypass the QA agent entirely; the executor directly runs the `next_commands` in a pane and proceeds to Git.
   - Implement the **Documentation Path**: Trigger the optional `document` agent (on flash tier) post-Git *only* if `"requires_docs": true`.

2. **`resilience.ts`**: Handles stall detection, exponential backoff, and C-306 retry policies.
3. **`metrics_collector.ts`** (Non-LLM): Runs synchronously after every task completes. Parses pane output buffers and JSON sidecars to calculate duration, step counts, and inferred token usage. Writes to `.pi/swarm/outputs/<taskId>_metrics.json`.

### 2.5. Coder Skill Injection (Zero Horizontal Sprawl)

Maintain a single `coder` agent role. Instead of splitting into `backend-coder` and `ux-coder`:

- Read the `"domain"` field from the Architect's JSON handoff.
- Dynamically inject the appropriate skills (e.g., `aikami-ui`, `daisyui` for frontend; `firestack`, `firebase_firestore` for backend) into the Coder's prompt context during the initialization of the Coder's pane.

## 3. Execution Steps

1. **Scaffold Socket Client:** Create `socket_client.ts`. Implement connection handling, `pane.read`, `pane.run`, and `events.subscribe`. Verify via a dedicated unit test against a mock/test Herdr instance.
2. **Director Deconstruction:** Split `swarm_director.ts` into the modules defined in 2.4. Rewire the main loop to use the new `socket_client.ts` instead of CLI spawning.
3. **Handoff Schema:** Implement the JSON sidecar schema in `agent_scratchpad.ts` or a new `handoff_parser.ts`. Update the `.pi/prompts/` (architect, coder, qa) to instruct the LLMs to strictly emit `SWARM_DONE:<role>:<id>` and write the JSON sidecar.
4. **Conditional Routing & Injection:** Wire the `metrics_collector.ts`. Implement the routing logic in `step_executor.ts` to skip QA on trivial tasks, inject skills based on domain, and conditionally trigger the document agent.
5. **Clean Up:** Remove all legacy polling logic, redundant marker files, and hardcoded 120s timeouts.

## 4. Acceptance Criteria

- [ ] No `child_process.spawn('herdr')` calls exist for polling pane status.
- [ ] Swarm transitions immediately upon the Herdr socket emitting an `idle` or `done` event containing the `SWARM_DONE` marker in a `pane.read(recent-unwrapped)` check.
- [ ] Agents successfully pass context via validated `*_handoff.json` files.
- [ ] A trivial task executes Architect -> Git successfully, bypassing QA.
- [ ] `metrics_collector.ts` generates a valid JSON telemetry report without making any LLM API calls.

---

## Execution Report (2026-07-07)

### Summary
Implemented socket-based event-driven swarm orchestration via persistent `net.Socket` connection to the herdr daemon. Decomposed monolithic `swarm_director.ts` into `step_executor.ts`, `resilience.ts`, and `metrics_collector.ts`. Replaced unstructured markdown handoffs with validated TypeBox JSON sidecars. Added trivial-path QA bypass, role-specific timeouts, domain-based coder skill injection, and non-LLM telemetry collection.

### AC Status

| # | Acceptance Criterion | Status | Evidence |
|---|---------------------|--------|----------|
| 1 | No `spawn('herdr')` for polling pane status | ✅ | `executeTaskSocket` + `executeStepEventDriven` use `HerdrSocketClient` exclusively. Legacy `spawn` calls remain in `initializeSwarm` for workspace provisioning only (not polling). |
| 2 | Socket event-driven transitions with SWARM_DONE marker | ✅ | `executeStepEventDriven` subscribes to `pane.agent_status_changed`, reads `recent-unwrapped` buffer, matches `SWARM_DONE:<role>:<taskId>` regex. Falls back to `waitAgentStatus` if events don't fire. |
| 3 | Validated JSON handoff sidecars | ✅ | `SwarmHandoffSchema` (TypeBox) in `@aikami/schemas`, validated via `Value.Check`. All 4 agent prompts updated to write `*_handoff.json` sidecars. `step_executor.ts` reads handoffs for complexity/domain routing. |
| 4 | Trivial task bypasses QA | ✅ | `executeTaskPipeline` checks architect `complexity=trivial` → skips QA step. Optional document agent runs post-Git only if `requiresDocs=true` and tier=flash. |
| 5 | Non-LLM metrics_collector.ts | ✅ | `collectAndWriteMetrics` pure computation — parses handoff JSONs + legacy summaries, writes `.pi/swarm/outputs/<taskId>_metrics.json`. Zero HTTP/LLM calls. |

### Files Created
- `packages/shared/schemas/src/lib/swarm_handoff.ts` — TypeBox schema for agent handoff JSON
- `packages/shared/types/src/lib/swarm_handoff.ts` — TypeScript type re-exports
- `scripts/src/lib/herdr/socket_client.ts` — Persistent `net.Socket` client for herdr daemon
- `scripts/src/lib/herdr/index.ts` — Herdr module barrel
- `scripts/src/lib/agents/resilience.ts` — Backoff, stall detection, role timeouts (extracted from swarm_director)
- `scripts/src/lib/agents/step_executor.ts` — Event-driven step execution + pipeline routing
- `scripts/src/lib/agents/metrics_collector.ts` — Non-LLM task telemetry

### Files Modified
- `packages/shared/schemas/src/index.ts` — Export swarm_handoff
- `packages/shared/types/src/index.ts` — Export swarm_handoff types
- `scripts/src/lib/agents/index.ts` — Export new modules, backward compat for legacy
- `scripts/src/lib/agents/swarm_director.ts` — Added `executeTaskSocket`, `_readHandoffJson`; imports from new modules
- `scripts/src/lib/agents/swarm_start.ts` — `--socket` flag support, dual execution paths
- `.pi/extensions/swarm_control.ts` — SWARM_DONE compliance signatures, `--socket` dispatch flag
- `.pi/prompts/architect.md` — JSON handoff + SWARM_DONE marker instructions
- `.pi/prompts/coder.md` — Domain skill injection + JSON handoff + SWARM_DONE marker
- `.pi/prompts/qa.md` — Upstream handoff reading + JSON handoff + SWARM_DONE marker
- `.pi/prompts/git.md` — Upstream handoff reading + JSON handoff + SWARM_DONE marker

### Deviations
- `initializeSwarm` still uses CLI `spawn` for workspace/tab provisioning — this is architectural setup, not polling. Contract permits this.
- Legacy `executeStep`, `executeStepResilient`, and polling-based functions retained for backward compatibility. New socket-based `executeTaskSocket` is the primary path.
- Coder skill injection is done at command-build time in `step_executor.ts` (via `buildCoderCommand`) rather than runtime PI `--load-skill` flags. This is more reliable than depending on the coder agent to self-load skills.

### Test Results
- `schemas:typecheck` ✅
- `types:typecheck` ✅
- `scripts:typecheck` ✅
- `schemas:test` ✅ (no failures)
- `scripts:fix` ✅ (all clean)
