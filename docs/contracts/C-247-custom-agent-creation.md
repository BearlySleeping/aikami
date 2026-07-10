## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/AGENT_SYSTEM.md` (Building A Custom Agent — prompt, output format, result type, phase, tools, connection override; Import And Export — folder-based packages), `docs/FRONTEND.md` (Agent Editor component — prompt template, phase, connection, tools, settings; `useCreateAgent`, `useUpdateAgent`, `useDeleteAgent` mutations), `docs/EXTENSIONS.md` (extension manifest format for packages); TODO.md C-ME-018 |
| **Target** | `apps/frontend/client/src/lib/views/agent/` + `apps/frontend/client/src/lib/services/agent/` — Agent editor UI, agent registry service, custom agent factory, import/export |
| **Priority** | P2 — Medium-high complexity, low-medium impact. Power-user feature; most users will use built-in agents |
| **Dependencies** | C-236 (Agent Pipeline System — COMPLETED for `AgentConfig`, `AgentRunResult`, `agentPipelineService`, `AgentHudState`, built-in agents + toggles), C-237 (Prompt Template & Macro System — COMPLETED for `resolveMacros()` engine), C-230 (Connection Config — COMPLETED for connection selector), `textGenerationService.extractStructure()` (C-080 — COMPLETED), `agent_schemas.ts` (EXISTING for TypeBox output validation) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Aikami's agent pipeline (C-236) currently has 6 built-in agents (world-state, quest-tracker, expression, prose-guardian, narrative-director, cyoa) with hardcoded prompts, schema validation, and per-chat toggle support. Marinara-Engine demonstrates the next logical step: a user-facing agent editor where users create custom agents with their own prompts, output schemas, phase selection, and connection overrides — all without touching code. This contract builds the agent registry service (CRUD for custom agent definitions), a DaisyUI agent editor form, a dynamic agent factory that converts user definitions into pipeline-compatible `AgentConfig` objects at runtime, and `.aikami.agent.json` import/export. The marketplace idea is deferred to a stretch goal.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/types/agent_types.ts` — `AgentConfig` (id, name, phase, systemPrompt, timeout, enabled, contextKey), `AgentRunResult`, `AgentPipelineContext`, `AgentHudState`, `ThoughtBubble`
- `apps/frontend/client/src/lib/services/agent/agent_schemas.ts` — TypeBox output schemas (`worldStateExtractionSchema`, `questUpdateSchema`, etc.), `AgentOutput` union type
- `apps/frontend/client/src/lib/services/agent/agent_pipeline_service.svelte.ts` — C-236 pipeline runner, `runAgents(configs, context)`, `getEnabledAgents()`
- `apps/frontend/client/src/lib/services/agent/agents/` — built-in agents dir (`world_state_agent.ts`, `quest_tracker_agent.ts`, `cyoa_agent.ts`)
- `apps/frontend/client/src/lib/services/agent/agent_hud_service.svelte.ts` — C-236 AgentHUD state, thought bubbles
- `apps/frontend/client/src/lib/views/settings/` — existing settings tab structure for new "Agents" tab
- `apps/frontend/client/src/lib/views/agent/` — C-236 agent HUD drawer, activity menu

**Marinara-Engine inspiration:**
- Agent editor: `examples/Marinara-Engine/docs/AGENT_SYSTEM.md` — "Building A Custom Agent": name, description, folder, prompt, output format, result type, phase, trigger settings, tools, connection override
- Agent mutations: `examples/Marinara-Engine/docs/FRONTEND.md` — `useCreateAgent()`, `useUpdateAgent()`, `useDeleteAgent()`
- Import/export: `examples/Marinara-Engine/docs/AGENT_SYSTEM.md` — folder-based packages, import does not auto-attach to chats
- Agent Suite: `examples/Marinara-Engine/docs/AGENT_SYSTEM.md` — inspect agent memory, tracker state, custom-agent outputs per chat

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Agent Registry**: New singleton `agentRegistryService` in `apps/frontend/client/src/lib/services/agent/agent_registry_service.svelte.ts`. Manages custom agent definitions (CRUD). Persisted to Firestore as documents in an `agent_definitions` collection owned by `uid`. Exposes `createAgent()`, `updateAgent()`, `deleteAgent()`, `getAgent()`, `listAgents()`, `importAgent()`, `exportAgent()`. Built-in agents are NOT managed by the registry — they remain constants.
- **Custom Agent Definition**: A new type `CustomAgentDefinition` extending `AgentConfig` with user-facing fields: `description`, `outputSchema` (Zod schema serialized as JSON Schema), `resultType` (discriminated union key), `connectionId` (optional connection override), `folder` (optional organization folder name), `isBuiltIn: false`, `createdAt`, `updatedAt`, `uid`.
- **Custom Agent Factory**: Function `customAgentToConfig(def: CustomAgentDefinition): AgentConfig` — converts a registry definition into a pipeline-compatible config. Resolves macros in the prompt template, validates the output schema, and returns a standard `AgentConfig` that the pipeline can execute natively.
- **Dynamic Agent Executor**: Extend `agentPipelineService` with `runCustomAgent(config: AgentConfig, context: AgentPipelineContext, aiResponse?: string): Promise<AgentRunResult>` — executes a custom agent using `textGenerationService.extractStructure()` with the user-defined schema and connection override.
- **Agent Editor UI**: New View + ViewModel in `apps/frontend/client/src/lib/views/agent/editor/`. DaisyUI form with: name, description, folder (chip input), phase (dropdown: pre/parallel/post), prompt template (textarea with macro autocomplete), output schema editor (code editor for JSON Schema), result type (dropdown from union), connection override (connection selector from C-230), test run button.
- **Import/Export**: `.aikami.agent.json` format — a single JSON file containing `formatVersion`, `type: "agent_definition"`, and the full `CustomAgentDefinition`. Import via file picker + drag-and-drop; export via JSON download.

## State & Data Models

**Custom agent definition** — extends the existing `AgentConfig`:

```typescript
interface CustomAgentDefinition {
    /** Format version for forward compatibility. */
    formatVersion: '1.0.0';
    /** Discriminator. */
    type: 'agent_definition';
    /** Unique agent identifier (generated on create). */
    id: string;
    /** Human-readable agent name (1-60 chars). */
    name: string;
    /** User-facing description of what the agent does. */
    description: string;
    /** Optional folder for organization (e.g. "Combat", "World"). */
    folder?: string;
    /** Execution phase. */
    phase: 'pre' | 'parallel' | 'post';
    /** Prompt template with optional macro placeholders ({{user}}, {{input}}, etc.). */
    promptTemplate: string;
    /** JSON Schema for validating the agent's structured output. */
    outputSchema: Record<string, unknown>;
    /** Result discriminator key (e.g. 'tracker_state', 'memory', 'command', 'custom'). */
    resultType: string;
    /** Optional connection ID override (use a different model than the chat). */
    connectionId?: string;
    /** Timeout in milliseconds (default: 15000). */
    timeout: number;
    /** Whether this agent is flagged as built-in (always false for custom). */
    isBuiltIn: false;
    /** Owner user ID. */
    uid: string;
    /** Creation timestamp (ISO 8601). */
    createdAt: string;
    /** Last update timestamp (ISO 8601). */
    updatedAt: string;
}
```

**Agent registry service interface:**

```typescript
interface AgentRegistryServiceInterface {
    /** Create a new custom agent definition. */
    createAgent(def: Omit<CustomAgentDefinition, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn' | 'formatVersion' | 'type'>): Promise<CustomAgentDefinition>;
    /** Update an existing custom agent. */
    updateAgent(id: string, updates: Partial<CustomAgentDefinition>): Promise<CustomAgentDefinition>;
    /** Delete a custom agent. Cannot delete built-in agents. */
    deleteAgent(id: string): Promise<void>;
    /** Get a single custom agent definition. */
    getAgent(id: string): Promise<CustomAgentDefinition | undefined>;
    /** List all custom agents for the current user, optionally filtered by folder. */
    listAgents(folder?: string): Promise<CustomAgentDefinition[]>;
    /** Duplicate an agent (copy with " (Copy)" suffix). */
    duplicateAgent(id: string): Promise<CustomAgentDefinition>;
    /** Import an agent from a .aikami.agent.json file. */
    importAgent(json: string): Promise<CustomAgentDefinition>;
    /** Export an agent as a .aikami.agent.json string. */
    exportAgent(id: string): Promise<string>;
    /** Test-run an agent against mock input. Returns the agent result. */
    testAgent(config: AgentConfig, mockInput: string): Promise<AgentRunResult>;
}
```

## Scope Boundaries

- **In Scope:**
    - Agent registry service — Firestore-backed CRUD for custom agent definitions
    - Custom agent factory — convert registry definitions to pipeline-compatible `AgentConfig`
    - Dynamic agent executor — pipeline runner extension for user-defined schemas
    - Agent editor ViewModel + Views — DaisyUI form with all fields
    - Agent list/browser — show built-in + custom agents with enable/disable toggles
    - Per-chat custom agent toggle — extends C-236's existing toggle system
    - Import/export `.aikami.agent.json` format
    - Duplicate agent functionality
    - Test-run button (dry-run agent against mock input)
- **Out of Scope:**
    - Agent marketplace / sharing platform (stretch beyond this contract)
    - Custom tool/function definitions within agents (Marinara's `CUSTOM_TOOLS.md` pattern — significant scope, could be its own contract)
    - Webhook-based agents (Marinara's `CUSTOM_TOOL_SCRIPT_ENABLED` pattern — sandbox concerns)
    - In-process VM script agents (security boundary — needs dedicated contract)
    - Agent folder/organization beyond flat list + folder field (no nested trees)
    - Agent editing of built-in agents (built-in agents are read-only templates; the user can duplicate and customize)
    - Agent suite / memory inspector (depends on C-240 session management + agent memory domains)

## Acceptance Criteria

### AC-1: Agent Registry CRUD
**Given** the agent registry service is initialized for the current user
**When** `createAgent({ name: "Combat Tracker", phase: "post", promptTemplate: "Extract combat events from: {{input}}", outputSchema: {...} })` is called
**Then** a new `CustomAgentDefinition` is created with a generated `id`, `createdAt` / `updatedAt` timestamps, `isBuiltIn: false`, `formatVersion: "1.0.0"`, and `type: "agent_definition"`. The definition is persisted to Firestore. Calling `listAgents()` returns it alongside any other custom agents. Calling `deleteAgent(id)` removes it. Calling `updateAgent(id, { name: "Battle Tracker" })` changes the name.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/agent/agent_registry_service.test.ts` — CRUD cycle + Firestore mock
- E2E / Visual:
    - **Functional**: `tests/client/agent-registry.spec.ts` — create, read, update, delete, duplicate, list
    - **Visual**: N/A

**Watch Points**:
- Built-in agents (prefixed with `builtin:` or equivalent) cannot be deleted or updated — throw `AgentError('Cannot modify built-in agent')`
- Duplicate agent gets a unique `id` with `(Copy)` suffix on name
- Firestore document ID equals the agent `id` field for consistency

### AC-2: Agent Editor UI
**Given** the user navigates to Settings → Agents → "Create Agent"
**When** the form renders
**Then** the editor shows:
- **Name** (text input, required, 1-60 chars)
- **Description** (textarea, optional, max 500 chars)
- **Folder** (chip input, optional, suggests existing folders)
- **Phase** (dropdown: "Pre-generation" / "Parallel" / "Post-processing")
- **Prompt template** (code textarea with monospace font, macro autocomplete on `{{`)
- **Output schema** (code editor for JSON Schema, validates on blur, shows error on invalid JSON)
- **Result type** (dropdown: "tracker_state", "memory", "command", "custom", or user-entered)
- **Connection override** (dropdown of saved connections + "Use chat default" option)
- **Timeout** (number input, default 15000ms, range 3000-60000)
- **Test Run** button at bottom
Saving creates the agent. Editing an existing agent pre-fills all fields.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Sandbox test — render `AgentEditorView` with blank state, fill fields, save, verify outputs
- E2E / Visual:
    - **Functional**: `tests/client/agent-editor.spec.ts` — full create/edit flow
    - **Visual**: `suites/agent-editor.visual.ts` — Screenshot the editor form with all fields filled

**Watch Points**:
- JSON Schema editor must surface parse errors inline (red border + error message), not block save
- Macro autocomplete must pull from C-237's existing macro registry (`{{user}}`, `{{input}}`, `{{chatId}}`, etc.)
- Phase dropdown must explain each option (tooltip or helper text)
- Saving with an empty name must show validation error and prevent submit

### AC-3: Dynamic Agent Execution
**Given** a custom agent definition with `phase: "post"`, `promptTemplate: "Summarize combat actions"`, `outputSchema: { type: "object", properties: { rounds: { type: "number" } } }`, and `connectionId: "conn-fast"` (a cheaper model)
**When** the agent pipeline reaches the post-processing phase
**Then** the custom agent is executed using `extractStructure()` with: (a) the resolved prompt template (macros expanded), (b) the custom output schema for validation, (c) the specified connection instead of the chat default. The result appears in `AgentRunResult[]` alongside built-in agent results.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — `custom_agent_executor.test.ts` — mock pipeline context, verify `extractStructure()` called with correct params
- E2E / Visual:
    - **Functional**: `tests/client/agent-execution.spec.ts` — create custom agent, enable for chat, send message, verify agent runs
    - **Visual**: N/A

**Watch Points**:
- If the specified connection is unavailable, fall back to the chat default and log a warning
- Custom agent timeout supersedes the default 15s — user-set values are respected
- Structured output that fails schema validation must be caught as an `AgentRunResult` with `success: false` and `error` message, not a crash
- Multiple custom agents can run in the same phase — order by creation date (oldest first) within the phase

### AC-4: Agent List & Toggle Management
**Given** the user has 3 custom agents and the 6 built-in agents
**When** viewing the Agents settings tab
**Then** the UI shows:
- **Built-in agents section**: 6 cards, each showing name, phase badge, description snippet, enable/disable toggle per agent (global default toggle)
- **Custom agents section**: 3 cards, each showing name, folder badge (if set), phase badge, edit/duplicate/delete/export buttons, enable/disable toggle
- **Per-chat override**: when viewing a specific chat's agent settings, toggles show per-chat state with "Use global default" indicator. Changing a toggle in the chat overrides only that chat.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Navigate settings → Agents, verify both sections render, toggle an agent
- E2E / Visual:
    - **Functional**: `tests/client/agent-list.spec.ts` — verify built-in + custom sections, toggles, per-chat override
    - **Visual**: `suites/agent-list.visual.ts` — Screenshot the agents list with both sections

**Watch Points**:
- Built-in agent cards must show `(Built-in)` badge and lack edit/delete buttons
- Deleting a custom agent that is enabled in active chats must warn: "This agent is enabled in 3 chats"
- Toggle changes must persist immediately (Firestore + local state)

### AC-5: Import/Export Agent Definitions
**Given** a custom agent definition exists
**When** "Export" is clicked on the agent card
**Then** a `.aikami.agent.json` file downloads containing `{ formatVersion: "1.0.0", type: "agent_definition", ...fullDefinition }`.
**When** "Import" is clicked and a `.aikami.agent.json` file is selected
**Then** the file is parsed, validated against the `CustomAgentDefinition` shape, and added to the registry with a new `id`. A success toast shows "Agent 'X' imported". Imported agents are NOT automatically enabled for any chat.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — `agent_registry_service.test.ts` extended with import/export round-trip
- E2E / Visual:
    - **Functional**: `tests/client/agent-import-export.spec.ts` — export, clear, re-import round-trip
    - **Visual**: N/A

**Watch Points**:
- Importing a file that isn't valid JSON or lacks `type: "agent_definition"` must show "Invalid agent file"
- Importing an agent with a duplicate name (same folder + name) appends `(2)` suffix
- Export must omit internal fields: `isBuiltIn`, `uid`, Firestore-internal metadata
- Import re-assigns `uid` to the current user (you own what you import)

### AC-6: Test Run (Agent Sandbox)
**Given** the agent editor is open for a custom agent with `promptTemplate: "Extract the mood from: {{input}}"`, `outputSchema: { type: "object", properties: { mood: { type: "string" } } }`, and a test input of `"The dragon roared and the ground shook with fury"`
**When** "Test Run" is clicked
**Then** the agent executes against the test input (not a real chat turn). A result panel appears showing: (a) the resolved prompt (macros expanded), (b) the raw LLM response, (c) the parsed output `{ mood: "fury" }`, (d) validation status (pass/fail), (e) execution time in ms. If the output fails schema validation, the raw response + error details are shown.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Sandbox test — render editor, click test run, verify result panel
- E2E / Visual:
    - **Functional**: `tests/client/agent-test-run.spec.ts` — test run with valid and invalid outputs
    - **Visual**: `suites/agent-editor.visual.ts` — include test run result panel in the screenshot

**Watch Points**:
- Test runs are free-form — no chat context, no real message history. Only `{{input}}` macro is populated from the test input field.
- Test runs use the agent's specified connection override, or the default connection if none set
- Consecutive test runs must cancel any in-flight previous test run via `AbortController`

## Implementation Sequence

1. **Phase 1 (Data Layer)**: Create `CustomAgentDefinition` type in `apps/frontend/client/src/lib/types/agent_types.ts`. Build `agentRegistryService` in `apps/frontend/client/src/lib/services/agent/agent_registry_service.svelte.ts` with Firestore CRUD. Add Firestore security rules for `agent_definitions` collection. Unit test full CRUD cycle.
2. **Phase 2 (Factory + Executor)**: Build `customAgentToConfig()` factory and `runCustomAgent()` executor in `apps/frontend/client/src/lib/services/agent/custom_agent_factory.ts`. Extend `agentPipelineService` to discover and execute custom agents alongside built-in ones. Unit test with mock pipeline context.
3. **Phase 3 (Editor UI)**: Build `AgentEditorView` + `AgentEditorViewModel` in `apps/frontend/client/src/lib/views/agent/editor/`. DaisyUI form with all fields, validation, macro autocomplete, test run panel. Build `AgentListView` for the settings tab with built-in + custom sections.
4. **Phase 4 (Import/Export)**: Add import/export methods to `agentRegistryService`. Build file picker + download logic in the editor ViewModel. Wire into the agent list UI.
5. **Phase 5 (Integration + Validation)**: Wire custom agents into per-chat toggle system (extend C-236's `enabledAgents` to include custom IDs). Run `validate()` with test=true. Run all functional E2E and visual tests.

## Edge Cases & Gotchas

- **Built-in agent ID collision**: Custom agents cannot use IDs matching built-in patterns (`world-state`, `quest-tracker`, `expression`, `prose-guardian`, `narrative-director`, `cyoa`). Registry rejects with clear error.
- **Circular macros**: Prompt template `{{output}}` referencing the agent's own output — detect at save time, warn but allow (some agents intentionally reference prior output). Don't crash at runtime.
- **Schema too large**: JSON Schema > 10KB — warn on save "Large schemas may cause slow agent execution". Don't reject.
- **Agent with no output schema**: If `outputSchema` is `{}` (empty object), the agent is treated as a raw text agent — output is stored as string in `AgentRunResult.output` without structured parsing. Valid use case for "rewrite this prose" agents.
- **Per-chat toggle race**: User rapidly toggles an agent on/off for a chat — debounce Firestore writes to last-write-wins with 500ms debounce.
- **Imported agent with future formatVersion**: `"formatVersion": "2.0.0"` — future version unknown to current code. Show "This agent definition requires Aikami v2.0 or later" error. Do not crash.
- **Agent execution order within phase**: Built-in pre agents run first (deterministic order per C-236), then custom pre agents (sorted by `createdAt`, oldest first). Same pattern for post agents. Parallel agents all run concurrently regardless of origin.
- **Macro resolution failure**: If `resolveMacros()` throws because of an unknown macro reference (e.g., `{{unknown_macro}}`), leave the placeholder in the prompt and log a warning. Do not fail the agent run.
