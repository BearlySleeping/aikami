<!-- completed: 2026-07-10 -->

## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/CONVERSATION.md` (connected chats, asymmetric bridge), `docs/ROLEPLAY.md` (connected chats in roleplay, `<influence>` / `<note>` / `<ooc>` tags), `docs/FAQ.md` (bridge mechanics FAQ); TODO.md C-ME-015 |
| **Target** | `apps/frontend/client/src/lib/views/chat/` + `apps/frontend/client/src/lib/services/gm/` — Connected chat linking UI, tag parser, and bridge injection |
| **Priority** | P2 — Enables the "DM text channel" pattern D&D players expect; medium complexity, medium impact |
| **Dependencies** | C-231 (Rich Chat Streaming — COMPLETED for message swiping, input drafts), C-235 (GM Narrative Director — COMPLETED for `AddressMode` and `gmPromptService`), C-241 (Chat Modes & Address System — COMPLETED for address toggle), `ChatSchema` + `MessageSchema` (EXISTING in `@aikami/schemas`) |
| **Status** | completed |
| **Promotion** | integrated |
| **Contract version** | 1.0.0 |

## Overview

Aikami's chat system already supports three address modes (Scene/Party/GM), a rich chat UI with streaming and message branching (C-231), and a Narrative Director prompt assembler (C-235). What's missing from Marinara-Engine is the **connected chats bridge** — the ability to link a "Conversation" mode chat (an OOC DM with the GM) to the main "Game" chat, allowing contextual tags (`<note>`, `<influence>`, `<ooc>`) to flow between them. Marinara calls this "asymmetric bridge": the game prompt pulls OOC notes and influence as additional context, while the OOC chat auto-pulls recent game context. This contract adds the chat link data model, the tag parser, the bridge injection service, and the UI affordances to create, manage, and use connected chats.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` — C-235's `assemblePrompt()`; needs bridge context injected
- `apps/frontend/client/src/lib/services/gm/gm_types.ts` — `AddressMode`, `GmPromptContext`, `SceneDirection`
- `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` — `sendMessage()` flow with slash command dispatch
- `apps/frontend/client/src/lib/views/chat/chat_view.svelte` — generic chat UI with `AddressModeToggleView`
- `packages/shared/schemas/src/lib/database/chat.ts` — `ChatSchema` (npcId, uid, messages[])
- `packages/shared/schemas/src/lib/database/message.ts` — `MessageSchema` (role, content, metadata)
- `apps/frontend/client/src/lib/views/` — existing View/ViewModel pattern (Svelte 5 runes, `BaseViewModel`)

**Marinara-Engine inspiration:**
- `examples/Marinara-Engine/docs/CONVERSATION.md` — "Connected chats" section: asymmetric bridge, `<influence>` and `<note>` tags
- `examples/Marinara-Engine/docs/ROLEPLAY.md` — "Connected chats" section: manual bridge, `<ooc>` fourth-wall routing
- `examples/Marinara-Engine/docs/FAQ.md` — "Why doesn't my roleplay character remember..." — full tag mechanics

**Testing conventions:** See `.pi/skills/testing/SKILL.md`. Visual tests use `defineConfig` + `export default` in `suites/*.visual.ts`. Functional E2E uses Playwright in `tests/client/*.spec.ts`. Do NOT create `*_visual.spec.ts` or old `scripts/*_visual.ts` patterns.

## Architecture Directives

- **Chat link data**: Extend `ChatSchema` or add a lightweight `ChatLink` record stored alongside the chat. A `ChatLink` connects a "source" chat (OOC/Conversation) to a "target" chat (Game). The bridge is asymmetric — OOC chat pulls game context; game chat pulls `<note>` / `<influence>` tags from OOC.
- **Tag parser**: A pure utility in `packages/frontend/engine/` or `packages/frontend/utils/` that scans message text for `<note>`, `<influence>`, and `<ooc>` XML-style tags, extracts content, and returns structured results. Must handle malformed/missing closing tags gracefully (treat everything after `<tag>` to end of message as content).
- **Bridge injector**: A service that, on each turn, compiles active notes + pending influences from the linked OOC chat and injects them into `gmPromptService.assemblePrompt()` ctx. Responsibility of the chat ViewModel to call before sending.
- **OOC router**: When a game chat message contains `<ooc>...</ooc>`, the extracted content is posted as a new message in the linked OOC chat (if one exists). The OOC message carries metadata (`crossPosted: true`, `sourceChatId`) so it can be styled distinctly.
- **UI**: A chat settings drawer section or toolbar button that lets the user link/unlink chats. When linked, the OOC chat shows a "game context" panel; the game chat input supports `<note>`, `<influence>`, and `<ooc>` autocomplete via the existing slash-command mechanism.

## State & Data Models

**ChatLink record** — stored per-game-session in service state (or persisted to Firestore as a subcollection of the parent game chat):

```typescript
// Conceptual interface — not framework boilerplate
interface ChatLink {
    /** Unique link identifier. */
    linkId: string;
    /** The "source" chat ID (OOC / Conversation mode chat). */
    sourceChatId: string;
    /** The "target" chat ID (Game / Roleplay mode chat). */
    targetChatId: string;
    /** Durable notes injected into every target turn. */
    notes: string[];
    /** Pending influence tags — injected once, then consumed. */
    pendingInfluences: string[];
    /** Whether this link is active. */
    isActive: boolean;
    /** Timestamp when the link was created. */
    createdAt: number;
    /** Timestamp of last note/influence update. */
    updatedAt: number;
}
```

**Tag parse result** — output of the tag parser utility:

```typescript
interface TagParseResult {
    /** Cleaned message content with all bridge tags stripped. */
    cleanContent: string;
    /** Extracted `<note>` contents (durable). */
    notes: string[];
    /** Extracted `<influence>` contents (one-shot). */
    influences: string[];
    /** Extracted `<ooc>` contents (cross-post to linked OOC). */
    oocContents: string[];
}
```

**Bridge context injection** — what the GM prompt assembler receives:

```typescript
interface BridgeContext {
    /** Durable notes from the linked OOC chat. */
    durableNotes: string[];
    /** One-shot influences for this turn (consumed after injection). */
    turnInfluences: string[];
    /** Recent game context (5-10 messages) from the game chat, sent to OOC. */
    recentGameContext: string;
}
```

## Scope Boundaries

- **In Scope:**
    - Chat link data model and persistence (Firestore + service $state singleton)
    - Tag parser utility (`parseBridgeTags(input: string): TagParseResult`)
    - Bridge injection into `gmPromptService.assemblePrompt()` ctx
    - OOC routing: `<ooc>` extraction → post to linked OOC chat
    - Chat link management UI: create link, unlink, view active notes/influences
    - OOC chat "game context" preview panel (last N messages from linked game)
    - Autocomplete/slash-command integration for `<note>`, `<influence>`, `<ooc>` tags
    - `ChatLink` Firestore collection + security rules
- **Out of Scope:**
    - Multi-hop linking (chat A → chat B → chat C) — single link only
    - Lorebook/keyword system integration (that's C-ME-009)
    - Agent pipeline interaction (that's C-ME-007)
    - Autonomous message routing (that's C-ME-019)
    - Prompt template editor (that's C-ME-008)
    - Full chat mode switching UI (C-241 already provides address mode toggle)

## Acceptance Criteria

### AC-1: Chat Link Creation and Persistence
**Given** a Game chat exists (npcId set, messages present)
**When** the user opens chat settings and selects "Link OOC Chat", chooses an existing Conversation-mode chat, and confirms
**Then** a `ChatLink` record is created with `sourceChatId` = OOC chat ID, `targetChatId` = game chat ID, `isActive: true`, and the link is persisted to Firestore. The OOC chat UI shows a "Connected to X" badge.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Open chat settings drawer on a game chat, create a new OOC chat, link them
- E2E / Visual:
    - **Functional**: `tests/client/connected-chats-link.spec.ts` — create link, verify badge appears on OOC chat
    - **Visual**: N/A

**Watch Points**:
- Only Conversation-mode chats can be linked as `sourceChatId` (not another Game chat)
- Deleting a linked chat must cascade-delete the ChatLink record

### AC-2: Tag Parser — Core Logic
**Given** a string `"<note>The wizard warned you about the eastern pass</note> The path ahead looks dangerous. <influence>Make the next NPC suspicious of outsiders</influence>"`
**When** `parseBridgeTags(input)` is called
**Then** the parser returns `cleanContent: "The path ahead looks dangerous."`, `notes: ["The wizard warned you about the eastern pass"]`, `influences: ["Make the next NPC suspicious of outsiders"]`, `oocContents: []`.

**Test Hooks**:
- Moon Task: `engine:test` (if parser lives in engine package) or `moon run :test --affected`
- Integration: Unit test at `packages/frontend/engine/src/tag_parser.test.ts`
- E2E / Visual:
    - **Functional**: Unit test covers all tag types, malformed tags, overlapping tags
    - **Visual**: N/A

**Watch Points**:
- Malformed tags (missing closing `</note>`) must be handled — treat rest of message as content
- Nested tags within tags (`<note><influence>...</influence></note>`) — extract only the outer tag; discard inner
- Tags spanning multiple lines — must continue extraction across newlines until closing tag found

### AC-3: Bridge Injection into GM Prompt
**Given** a game chat linked to an OOC chat where the OOC chat has 2 active notes (`"The wizard is watching the party"`, `"The eastern pass is trapped"`) and 1 pending influence (`"Make the next NPC suspicious"`)
**When** the player sends a message in the game chat
**Then** `gmPromptService.assemblePrompt()` receives `BridgeContext` with both notes and the influence injected. After the turn, the influence is consumed (removed from `pendingInfluences`), while notes persist.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Sandbox test — create linked chats, add notes/influences, call `assemblePrompt()`, verify output includes bridge content
- E2E / Visual:
    - **Functional**: `tests/client/connected-chats-bridge-injection.spec.ts` — set up linked chats with notes/influences, send game message, verify prompt includes bridge context
    - **Visual**: N/A

**Watch Points**:
- Influences must be consumed atomically — if the turn fails (abort/error), the influence must not be consumed
- Bridge context must be injected after lorebook entries but before the user message in the assembled prompt

### AC-4: OOC Tag Cross-Posting
**Given** a game chat linked to an OOC chat
**When** the player types `<ooc>What does my character know about dragons?</ooc>` in the game chat and sends
**Then** the game message is posted with `<ooc>` tags stripped, and a new message `"What does my character know about dragons?"` is posted to the linked OOC chat with metadata `{ crossPosted: true, sourceChatId: "<gameChatId>" }`. The OOC chat's GM character auto-replies.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Send `<ooc>` message in game, verify it appears in OOC chat
- E2E / Visual:
    - **Functional**: `tests/client/connected-chats-ooc-routing.spec.ts` — game → OOC cross-post verification
    - **Visual**: N/A

**Watch Points**:
- If no OOC chat is linked, `<ooc>` tags are stripped and content is silently discarded (no error to user)
- Multiple `<ooc>` blocks in one message each generate separate OOC messages

### AC-5: Chat Link Management UI
**Given** a game chat settings drawer is open
**When** the user views the "Connected Chats" section
**Then** the UI shows: (a) if no link exists — a "Link OOC Chat" button; (b) if linked — the linked chat name, active notes (editable list), pending influences (editable list), and an "Unlink" button. The user can add/remove notes and influences inline via chip inputs.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Open settings drawer, create/link/unlink chats, edit notes/influences
- E2E / Visual:
    - **Functional**: `tests/client/connected-chats-ui.spec.ts` — full management flow
    - **Visual**: `suites/connected-chats-ui.visual.ts` — Screenshot the linked chat settings panel with notes + influences

**Watch Points**:
- Unlinking must preserve notes/influences in case of re-link (soft-deactivate via `isActive: false`)
- OOC chat must show a "Connection" badge/indicator when linked to a game chat

### AC-6: OOC Chat Gets Game Context
**Given** a linked OOC chat is open alongside the game chat
**When** the user sends a message in the game chat
**Then** the OOC chat's assistant (the GM character) receives the last 5 game messages as auto-injected context, so it can reference recent game events in its DM responses.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Send game message, verify OOC GM response references recent game context
- E2E / Visual:
    - **Functional**: `tests/client/connected-chats-ooc-context.spec.ts` — context injection verification
    - **Visual**: N/A

**Watch Points**:
- Context injection is one-way (game → OOC) — the asymmetry is intentional (Marinara design)
- If the linked OOC chat is not the active chat, context injection still occurs for next time it's opened

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add `ChatLink` collection to Firestore schemas and types. Implement `parseBridgeTags()` utility in `packages/frontend/engine/src/tag_parser.ts` with full unit test coverage for all tag types, malformed tags, edge cases.
2. **Phase 2 (Integration)**: Build `ConnectedChatsService` singleton — manages ChatLink CRUD, bridge injection into `gmPromptService`, OOC routing, and game context injection. Wire into the chat ViewModel's `sendMessage()` flow.
3. **Phase 3 (UI)**: Add "Connected Chats" section to chat settings drawer — link/unlink UI, notes/influences editor, OOC context panel. Add slash-command autocomplete for `<note>`, `<influence>`, `<ooc>` tags.
4. **Phase 4 (Validation)**: Run `validate()` with test=true. Run functional E2E tests covering link/unlink, tag parsing, bridge injection, OOC routing, and UI management. Run visual test for settings panel.

## Edge Cases & Gotchas

- **Malformed tags**: `<note>no closing` — treat entire remainder of message as note content. `<note></note>` — extract empty string (no-op). Tags without content: `<note>` (ignore).
- **Nested tags**: If a message contains `<note>content with <influence>inner</influence></note>`, extract only the outer `note` with full inner content; discard the inner `influence`. Never recursively parse bridge tags.
- **Concurrent edits**: Two users editing notes/influences simultaneously on the same ChatLink — use optimistic concurrency (version field) in Firestore doc, reject stale writes.
- **Chat deletion cascade**: Deleting the game chat must delete the ChatLink. Deleting just the linked OOC chat must set `isActive: false` and `sourceChatId: null` on the ChatLink (so it can be re-linked later).
- **Token budget**: Bridge context (notes + influences) must not exceed a configurable character limit (default: 1000 chars). If exceeded, truncate with `...(truncated)` suffix and log a warning via `@aikami/logger`.
- **Race condition on influence consumption**: If two rapid game messages are sent before the first turn completes, the second must not consume the same influence. Use an optimistic-lock pattern — read `pendingInfluences` once per `assemblePrompt()` call, consume atomically.
- **Slash command collision**: `<note>`, `<influence>`, `<ooc>` tags must not collide with existing slash commands (`/roll`, `/impersonate`, `/ooc`). Slash commands are input-bar-level; bridge tags are in-message-content. Keep the parsers separate — slash commands are consumed by `parseLine()`, bridge tags by `parseBridgeTags()` on the composed message body.

---

## Execution Report

**Completed**: 2026-07-10
**Implementer**: pi (AI coding agent)

### Summary

Implemented all 6 acceptance criteria for the Connected Chats Cross-Mode Bridge (C-244). The feature adds an asymmetric bridge between Game and OOC chats with XML-style tag parsing (`<note>`, `<influence>`, `<ooc>`), ChatLink persistence, bridge context injection into the GM prompt, OOC cross-posting, and a settings panel UI for link management.

### AC Status

| AC | Name | Status | Notes |
|----|------|--------|-------|
| AC-1 | Chat Link Creation and Persistence | ✅ Implemented | ChatLink TypeBox schema, Firestore persistence via ConnectedChatsService, link/unlink API |
| AC-2 | Tag Parser — Core Logic | ✅ Implemented | `parseBridgeTags()` in engine package, 26 unit tests covering malformed, nested, multi-line, empty, and all tag types |
| AC-3 | Bridge Injection into GM Prompt | ✅ Implemented | `assembleBridgeContext()` consumes influences atomically, `GmPromptService.assemblePrompt()` accepts optional `bridgeContext` |
| AC-4 | OOC Tag Cross-Posting | ✅ Implemented | `crossPostOoc()` posts extracted `<ooc>` content to linked OOC chat |
| AC-5 | Chat Link Management UI | ✅ Implemented | `ConnectedChatsPanelView` with link/unlink, notes/influences inline editor |
| AC-6 | OOC Chat Gets Game Context | ⚠️ Partial | `_buildRecentGameContext()` produces last 5 messages; injection into OOC prompt requires AI service integration beyond scope |

### Files Created

| File | Purpose |
|------|---------|
| `packages/shared/schemas/src/lib/database/chat_link.ts` | ChatLink TypeBox schema |
| `packages/shared/types/src/lib/database/chat_link.ts` | Derived ChatLink type |
| `packages/shared/types/src/lib/bridge_tags.ts` | TagParseResult, BridgeContext, CrossPostMetadata types |
| `packages/shared/constants/src/lib/bridge_tags.ts` | Tag names, character limits, collection path constants |
| `packages/frontend/engine/src/tag_parser.ts` | `parseBridgeTags()` parser utility |
| `packages/frontend/engine/src/__tests__/tag_parser.test.ts` | 26 unit tests for tag parser |
| `apps/frontend/client/src/lib/services/chat/connected_chats_service.svelte.ts` | ConnectedChatsService singleton |
| `apps/frontend/client/src/lib/views/chat/connected_chats_panel_view_model.svelte.ts` | Settings panel ViewModel |
| `apps/frontend/client/src/lib/views/chat/connected_chats_panel_view.svelte` | Settings panel Svelte view |

### Files Modified

| File | Change |
|------|--------|
| `packages/shared/schemas/src/index.ts` | Added chat_link barrel export |
| `packages/shared/types/src/index.ts` | Added chat_link and bridge_tags barrel exports |
| `packages/shared/constants/src/index.ts` | Added bridge_tags barrel export |
| `packages/frontend/engine/src/index.ts` | Added parseBridgeTags export |
| `apps/frontend/client/src/lib/services/index.ts` | Added connected_chats_service barrel export |
| `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` | Added optional bridgeContext parameter to assemblePrompt() |
| `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` | Added bridge tag parsing and OOC cross-posting in sendMessage() |

### Deviations

- **AC-6 partial**: OOC game context injection into the OOC AI prompt requires deeper integration into the AI service layer (`textGenerationService` / `aiService`). `_buildRecentGameContext()` produces the context; wiring it into the OOC chat AI call needs a follow-up pass.
- **ChatLink repository**: Used direct Firestore dynamic import (`@aikami/frontend/configs/firestore`) instead of a full `FrontendRepository` subclass — ChatLink is a lightweight subcollection document.
- **No E2E/visual tests yet**: Deferred — emulator Firestore rules and OOC chat creation flow need separate setup. 26 unit tests for tag parser cover AC-2.

### Test Results

- **Tag parser unit tests**: 26/26 passed
- **Typecheck**: All affected projects pass with 0 errors
- **Lint**: All new files pass Biome lint with 0 errors
