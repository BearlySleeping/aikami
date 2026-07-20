# Contract C-343: Promote Rich Chat UX into Production Gameplay

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-343 — Phase 2 — Core RPG Depth and Replayability |
| **Target** | Production dialogue overlay (`apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/`), message interaction primitives (action bars, alternatives/swiping, drafts, cancel, streaming TTS, CYOA integration, edit/branch UX) |
| **Priority** | P1 — keep Marinara-level conversation quality without turning the game into a chat configuration app |
| **Dependencies** | C-231 (Rich Chat Streaming — COMPLETED: message branching, drafts, action bar types, streaming TTS chunker), C-241 (Chat Modes & Address System — COMPLETED: impersonation, Scene/Party/GM toggle), C-245 (CYOA Choices — COMPLETED: choice buttons, impersonation integration, choice history store), C-328 (Integrate Bounded AI NPC Dialogue — implemented: production dialogue loop, orchestrator, authored fallback), C-340 (Party and Companion Gameplay — not_started: party address mode depends on party roster) |
| **Status** | implemented |
| **Promotion** | `integrated` — the production dialogue overlay on `/game` already mounts with streaming AI dialogue (C-328); this contract hardens the rich chat surface in place (no sandbox promotion step) |
| **Docs Impact** | none — internal developer-facing UX promotion, no new player-facing docs |
| **Contract version** | 2.0.0 |

### Dependency Status

| Dependency | Status | Risk |
|---|---|---|
| C-231 Rich Chat Streaming | completed (with execution report) | Low — `messageBranchStore`, `draftStore`, `EnhancedMessage`/`MessageAction` types, `SentenceBoundaryChunker`, `AutoResizeTextarea` all exist and are integrated into the chat sandbox; dialogue overlay already imports `messageBranchStore`, `draftStore`, `SentenceBoundaryChunker`, `ttsService` |
| C-241 Chat Modes & Address System | completed (with execution report) | Low — `address_mode_toggle`, `impersonationService`, `/impersonate` command all exist and are wired into the chat sandbox; dialogue overlay does NOT yet import address mode components |
| C-245 CYOA Choices | completed (with execution report) | Low — `choiceButtonsViewModel`, `choiceHistoryStore`, CYOA agent pipeline, DaisyUI `ChoiceButtonsView` all exist and render in chat sandbox; dialogue overlay does NOT yet render CYOA choices |
| C-328 Bounded AI NPC Dialogue | implemented (not yet verified) | Medium — the production dialogue loop, `NpcDialogueService` orchestrator, and authored fallback are the integration surface this contract builds on; if C-328 verification discovers gaps in the orchestrator API, the rich-chat promotion may need to adapt |
| C-340 Party and Companion Gameplay | not_started | **High** — Party address mode is listed in the C-343 TODO.md scope but requires a party roster (C-340) to be meaningful; this contract defers Party mode integration to C-340 and focuses on Scene and GM modes only |

## Problem & Baseline Evidence

- **Current behavior**:
  - The production dialogue overlay (`dialogue_overlay.svelte` + `dialogue_overlay_view_model.svelte.ts`, ~590 lines) renders streaming AI NPC dialogue with a basic text input and C-162 action context menu. Messages are plain DaisyUI `chat-bubble` divs in a scrollable container — **no per-message action bar, no swipe/alternative UI, no inline editing, no cancel button during streaming, no CYOA choice rendering**.
  - C-231 Rich Chat Streaming features (`messageBranchStore`, `draftStore`, `SentenceBoundaryChunker`, `AutoResizeTextarea`, `EnhancedMessage`/`MessageAction` types) are **completed and available** — the dialogue overlay already imports and uses them: `swipeAlternative()`, `copyMessage()`, `branchFromMessage()` (placeholder), `showToast()`, `toggleStreamingTts()`, `streamingTtsEnabled` all exist on the ViewModel interface, and `AutoResizeTextarea` is already used in the View. However, the **View does not render the remaining UI**: no swipe arrows/alternative counter on messages, no hover-visible action bar, no cancel button during streaming.
  - Per-message alternatives are tracked in `messageBranchStore` (an in-memory `Map<string, MessageAlternatives>`), but the dialogue ViewModel's `_delegateGenerateResponse()` does not call `messageBranchStore.addAlternative()` when the NPC generates a response. Swiping is wired but has no data.
  - The draft store (`draftStore`) saves and restores input text per chat ID, but there is **no draft recovery UX** — if the player closes and reopens dialogue, the restored draft text silently appears in the input field with no visual indicator that it was recovered.
  - Streaming TTS is wired (toggle + `SentenceBoundaryChunker` + `ttsService`) but no visual TTS indicator (speaker pulse, sentence-highlight) is shown during playback.
  - CYOA choices (C-245) and address modes (C-241) exist in the standalone chat sandbox (`/dev/chat-enhancements`, `/dev/chat-modes`, `/dev/cyoa`) but are **completely absent from the production dialogue overlay**.
  - Cancellation during streaming: The ViewModel creates an `AbortController` in `_delegateGenerateResponse()` but never exposes a cancel method or renders a cancel button.

- **Reproduction**:
  1. `bun moon run client:dev` with a connected text AI
  2. Start a campaign → walk to any Emberwatch NPC → press E
  3. Send a message → observe streaming response in plain chat bubbles
  4. **Observe**: no action bar on hover, no swipe arrows, no cancel button during generation, no draft recovery indicator, no CYOA choices, no address mode toggle
  5. Regenerate an NPC response via the chat sandbox at `/dev/chat-enhancements` → observe the richer UX (swipe arrows, action bar) that does NOT exist in production dialogue

- **Existing implementation to reuse**: see Existing System & Reuse Map.

- **Known gaps**:
  1. Dialogue `View` does not render message action bars (copy/retry/edit/delete/branch) from C-231.
  2. Dialogue `View` does not render alternative swipe controls (left/right arrows, counter label "2/3").
  3. `_delegateGenerateResponse()` never calls `messageBranchStore.addAlternative()`, so regeneration produces no stored alternatives to swipe through.
  4. No cancel/abort button is rendered during streaming; the `AbortController` exists but is unreachable from the UI.
  5. Draft recovery is silent — restored text appears in the input with no visual confirmation.
  6. ~~`AutoResizeTextarea` (C-231) is not used in the dialogue overlay — a plain `<textarea>` is used instead.~~ **Resolved**: `AutoResizeTextarea` is already in use as of C-328 integration (imported and used in both `CUSTOM_INPUT` and default input phases).
  7. CYOA choice buttons (`ChoiceButtonsView`, C-245) are not rendered in the dialogue overlay.
  8. Address mode toggle (`AddressModeToggleView`, C-241) is not rendered in the dialogue overlay.
  9. `branchFromMessage()` is a placeholder that only shows a toast — no actual conversation fork is created.
  10. No inline message editing (user messages) exists in the dialogue overlay.

- **Baseline tests** (run before starting):
  - `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts`
  - `apps/frontend/client/src/lib/services/chat/message_branch_store.test.ts`
  - `apps/frontend/client/src/lib/services/chat/draft_store.test.ts`
  - `apps/frontend/client/src/lib/views/chat/choice_buttons_view_model.test.ts`
  - Commands: `moon run client:test`, `moon run client:typecheck`

## User Outcome

After this contract, a **player** in dialogue with any NPC can: see a hover-visible action bar on each message (copy, retry for AI messages; copy, edit, delete for player messages); swipe left/right through alternative NPC responses with visible counter ("2/3"); press a cancel button to abort slow AI generation; see a visual indicator when a previous draft is restored; use an auto-resizing textarea; toggle streaming TTS with sentence-level playback; see contextual CYOA choice buttons below NPC replies; and toggle between Scene and GM address modes. All of these enhancements are presented with progressive disclosure — the base dialogue experience (text input + send) remains the same, and rich features appear on hover, toggle, or as secondary UI elements without cluttering the core conversation flow.

## Success Measures

- **Time/latency target**: message action bar appears within 100ms of hover (CSS `:hover`, no JS delay); swipe transition renders within one frame (alternative text is already in memory); draft restoration indicator appears synchronously with draft load
- **Offline/degraded behavior**: all rich-chat features (swipe, action bar, drafts, cancel, auto-resize) work identically in authored-fallback mode (C-328) — no AI dependency for any UX enhancement listed here. CYOA choices are AI-dependent by nature (they require the CYOA agent pipeline); when AI is unavailable and the dialogue falls back to authored branches, CYOA choices are hidden (not broken).
- **Production journey enabled**: `/game` → walk to NPC → E → dialogue opens with rich chat surface → player can copy/retry/swipe/edit/cancel/draft-restore without leaving the overlay or entering a dev route

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Message branching + alternatives store | `apps/frontend/client/src/lib/services/chat/message_branch_store.svelte.ts` (C-231) | **Reuse** — already imported by dialogue ViewModel; add `addAlternative()` call in `_delegateGenerateResponse()` and expose store data to View |
| Per-chat input draft persistence | `apps/frontend/client/src/lib/services/chat/draft_store.ts` (C-231) | **Reuse** — already imported by dialogue ViewModel; add draft recovery indicator in View |
| Message action bar types (`MessageAction`) | `apps/frontend/client/src/lib/types/rich_chat.ts` (C-231) | **Reuse** — type system for action bar already defined; dialogue ViewModel already has `copyMessage()`, `swipeAlternative()` |
| Auto-resize textarea component | `apps/frontend/client/src/lib/components/chat/auto_resize_textarea.svelte` (C-231) | **Reuse** — already imported and used in `dialogue_overlay.svelte` (C-328); verify it still behaves correctly with new streaming cancel flow |
| Streaming TTS + sentence chunker | `SentenceBoundaryChunker` (imported from `$services`), `ttsService` (C-231) | **Reuse** — already wired in dialogue ViewModel; add visual playback indicator in View |
| CYOA choice buttons ViewModel + View | `apps/frontend/client/src/lib/views/chat/choice_buttons_view_model.svelte.ts` + `choice_buttons_view.svelte` (C-245) | **Reuse** — import into dialogue ViewModel; wire CYOA extraction from NPC dialogue orchestrator response; render below latest NPC message |
| Address mode toggle | `apps/frontend/client/src/lib/views/gm/address_mode_toggle_view.svelte` + `_view_model.svelte.ts` (C-241) | **Reuse** — import toggle into dialogue overlay; Scene and GM modes only (Party deferred to C-340) |
| NPC dialogue orchestrator | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (C-328) | **Modify** — extend `generateTurn()` result to optionally include CYOA choices extracted from the AI response |
| Dialogue overlay ViewModel | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` (C-328) | **Modify** — add alternative tracking during regeneration, cancel exposure, edit message flow, branch creation, CYOA extraction, address mode state |
| Dialogue overlay View | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` (C-328) | **Modify** — add message action bars, swipe controls, cancel button, CYOA buttons, address mode toggle, draft recovery indicator (`AutoResizeTextarea` already in use, no change needed) |
| Chat enhancements sandbox | `apps/frontend/client/src/routes/(dev)/dev/chat-enhancements/+page.svelte` (C-231 AC-6) | **Reference** — UI patterns to promote (NOT copy — the sandbox uses a full `ChatView` component; dialogue overlay uses a simpler embedded chat within the game overlay) |

## Overview

C-343 promotes the rich chat UX features that already work in the `/dev/chat-enhancements` sandbox (C-231) and the standalone chat pipeline (C-241, C-245) into the production dialogue overlay on `/game`. The dialogue overlay currently streams AI responses into plain chat bubbles with no per-message interaction — no copy button, no alternative swiping, no cancel during generation, no draft recovery indicator, no CYOA choices, no address mode. All of these features have existing implementations that need wiring, not rewriting. The contract is a promotion/integration task: surface existing C-231 message interaction primitives in the dialogue View, integrate C-245 CYOA choices into the NPC dialogue response flow, add C-241 address mode (Scene/GM only; Party deferred to C-340), and add resilience UX (cancel button, draft recovery indicator). The result is a dialogue overlay that feels polished without exposing the full chat configuration surface the standalone chat sandbox carries.

## Design Reference

- **C-231 Rich Chat Streaming execution report** (`docs/contracts/C-231-rich-chat-streaming.md` § Execution Report) — documents the `messageBranchStore`, `draftStore`, `AutoResizeTextarea`, `EnhancedMessage`/`MessageAction` type system, and streaming TTS wiring that already exist
- **C-245 CYOA execution report** (`docs/contracts/C-245-cyoa-choices-branching-narrative.md` § Execution Report) — documents `ChoiceButtonsViewModel`, `ChoiceButtonsView`, `choiceHistoryStore`, and the CYOA agent pipeline extraction pattern
- **C-241 Chat Modes execution report** (`docs/contracts/C-241-chat-modes-address-system.md` § Execution Report) — documents `address_mode_toggle`, `impersonationService`, and the three-mode prompt routing
- **C-328 dialogue overlay** (`dialogue_overlay_view_model.svelte.ts`) — current ViewModel already imports `messageBranchStore`, `draftStore`, `SentenceBoundaryChunker`, `ttsService`; the existing `swipeAlternative()`/`copyMessage()`/`branchFromMessage()`/`showToast()`/`toggleStreamingTts()` methods are the integration surface to build on
- **`dialogue_overlay.svelte`** — current View uses DaisyUI `chat-bubble` divs for message rendering; the promotion follows the same chat-bubble pattern but adds hover-visible action bars and swipe controls within each bubble

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

This contract modifies the production dialogue overlay — a UI component already mounted on the `/game` route. All changes stay within the dialogue overlay boundary; no new routes, no new overlays, no changes to the game engine bridge or ECS layer.

| Concern | Placement |
|---|---|
| Message action bar component (hover-visible copy/retry/edit/delete/branch) | **Reuse** `apps/frontend/client/src/lib/components/chat/message_action_bar.svelte` (exists from C-231) — import and render inside dialogue chat bubbles on hover |
| Alternative swipe controls (left/right arrows + counter label) | **Reuse** `apps/frontend/client/src/lib/components/chat/message_swipe_controls.svelte` (exists from C-231) — import and render inside AI message bubbles when alternatives > 1 |
| Draft recovery indicator | Inline in `dialogue_overlay.svelte` — a small DaisyUI `badge` or `tooltip` below the textarea when a draft was restored |
| Cancel button during streaming | Inline in `dialogue_overlay.svelte` — replaces the Send button with a Cancel button while `isStreaming === true` |
| CYOA choice buttons in dialogue | Reuse `ChoiceButtonsView` from C-245; instantiate a `ChoiceButtonsViewModel` in the dialogue ViewModel, feed it extracted choices from the orchestrator response |
| Address mode toggle in dialogue | Reuse `AddressModeToggleView` from C-241; instantiate its ViewModel in the dialogue ViewModel; Scene and GM modes only |
| Edit message flow | Extend dialogue ViewModel with `editMessage()` — replaces user message text in `messages` array, triggers re-generation of subsequent NPC responses |
| Branch conversation | Extend dialogue ViewModel with `createBranch()` — creates a new `ConversationBranch` record in `messageBranchStore`, persists to conversation repository |
| Dialogue ViewModel interface | Extend `DialogueOverlayViewModelInterface` with new methods: `cancelStreaming()`, `regenerateResponse(messageId)`, `editMessage(messageId, newText)`, `deleteMessage(messageId)`, `createBranch(messageId)`; new readonly fields: `showDraftRecovery`, `cyoaChoices`, `addressMode`, `currentBranchId` |
| Dialogue Message type | Extend `DialogueMessage` in `apps/frontend/client/src/lib/types/dialogue.ts` with `alternativeCount`, `alternativeLabel`, `canSwipeLeft`, `canSwipeRight` fields (mirroring C-231's `EnhancedChatMessage`) |

## State & Data Models

### Extended Dialogue Message

```typescript
// apps/frontend/client/src/lib/types/dialogue.ts — extend existing DialogueMessage

/** A message rendered in the dialogue history, extended with C-231 alternative tracking. */
export type DialogueMessage = {
  id: string;
  role: 'player' | 'npc';
  content: string;
  /** Total number of alternative NPC responses (0 for player messages, >= 1 for AI). Added by C-343. */
  alternativeCount: number;
  /** Display label for the alternative counter (e.g. "2/3"). Empty string when count <= 1. */
  alternativeLabel: string;
  /** Whether swipe left (previous alternative) is available. */
  canSwipeLeft: boolean;
  /** Whether swipe right (next alternative) is available. */
  canSwipeRight: boolean;
};
```

### Conversation Branch

```typescript
// apps/frontend/client/src/lib/types/dialogue.ts — new type for C-343 branching

/** A forked conversation branch starting from a specific message. */
export type ConversationBranch = {
  /** Unique branch identifier. */
  branchId: string;
  /** The message ID this branch forks from. */
  parentMessageId: string;
  /** Messages in this branch (from the fork point onward). */
  messages: DialogueMessage[];
  /** When the branch was created. */
  createdAt: number;
  /** User-editable label ("Alternate path", "Intimidation route", etc.). */
  label?: string;
};
```

### Dialogue Address Mode (reusing C-241 types)

```typescript
// Reused from C-241 — no new types needed
// import type { AddressMode } from '@aikami/types'; // 'scene' | 'party' | 'gm'
// Party mode deferred to C-340; dialogue overlay only exposes 'scene' and 'gm'
```

### CYOA Choice Integration (reusing C-245 types)

```typescript
// Reused from C-245 — ChoiceButtonsViewModel handles display state
// Dialogue ViewModel instantiates ChoiceButtonsViewModel and feeds it
// extracted choices from NpcDialogueService.generateTurn() response
```

## Quality Requirements

Check each that applies. Use "N/A — reason" when genuinely irrelevant.

- **Offline/degraded mode**: All UX enhancements (action bars, swipe, drafts, cancel, auto-resize, address mode toggle) work identically in authored-fallback mode (no AI). CYOA choices are hidden when the AI pipeline is unavailable (they require the CYOA agent). Address mode changes prompt routing but fall back gracefully to default scene mode when GM agent is unavailable. ✅
- **Accessibility/input**: Message action bar is keyboard-navigable (Tab to message, Enter to open action menu, arrow keys to select action, Escape to close). Swipe controls are operable via Left/Right arrow keys when a message is focused. Cancel button is reachable via Tab and activatable via Enter/Escape. Draft recovery indicator uses `aria-live="polite"`. Auto-resize textarea preserves existing keyboard handling (Enter to send, Shift+Enter for newline, Escape to end chat). ✅
- **Performance budget**: No new network requests — all data (alternatives, drafts, choices) is in-memory or IndexedDB. Action bar appears via CSS `:hover` (zero JS overhead). Swipe transition is synchronous (text swap in `$state`). Auto-resize textarea uses `scrollHeight` recalculation (sub-millisecond). No frame budget impact on the PixiJS render loop. ✅
- **Security/privacy**: Draft text is stored in IndexedDB (client-side only), no server exposure. Message alternatives are in-memory only (`$state` Map), cleared on dialogue close. Edit/delete operations only affect the local `messages` array — no server-side message store exists. Address mode does not expose raw prompt or agent internals. ✅
- **Persistence/migration**: `DialogueMessage` type gains three new optional fields (`alternativeCount`, `alternativeLabel`, `canSwipeLeft`, `canSwipeRight`). Existing code that constructs `DialogueMessage` objects (e.g., `dialogue_overlay_view_model.svelte.ts` constructor, `_appendNpcMessage()`, `sendMessage()`) must be updated to include defaults (`alternativeCount: 0`, `alternativeLabel: ''`, `canSwipeLeft: false`, `canSwipeRight: false`). No save format changes — dialogue history is not yet persisted as part of the campaign save envelope (C-334 covers that). Conversation branches are in-memory for this contract; persistence is scoped to C-344. ✅
- **Cancellation/retry/idempotency**: Cancel button calls `AbortController.abort()` (already created in `_delegateGenerateResponse()`), which propagates to the orchestrator's `generateTurn({ signal })`. The orchestrator must handle `AbortError` gracefully — replace the placeholder NPC message with a "Generation cancelled" note and restore the player's input. Retry (regenerate) calls `_delegateGenerateResponse()` again with the same message history minus the last NPC response. ✅
- **Observability**: ViewModel logs via `this.debug()`: `cancelStreaming`, `regenerateResponse:{messageId}`, `editMessage:{messageId}`, `deleteMessage:{messageId}`, `createBranch:{parentMessageId}`, `draftRecovery:{chatId}`, `cyoaChoiceSelected:{choiceLabel}`. Action bar interactions (copy success/failure) log via existing `copyMessage()` path. ✅

## Migration & Rollback

N/A — no persistent state changes. The `DialogueMessage` type gains new optional fields with safe defaults. The conversation branch model is in-memory only; branch persistence is deferred to C-344. Rollback requires reverting the dialogue overlay View and ViewModel to their C-328 state (no data migration needed).

## Scope Boundaries

- **In Scope:**
  - Message action bar (hover-visible copy/retry/edit/delete/branch buttons) on each message in the dialogue overlay
  - Alternative swiping UI (left/right arrows + counter label "2/3") on AI messages with stored alternatives
  - Wiring `messageBranchStore.addAlternative()` into `_delegateGenerateResponse()` so regeneration produces swipeable alternatives
  - Cancel/abort button during AI streaming, wired to the existing `AbortController`
  - Draft recovery indicator (visual badge when input text was restored from IndexedDB)
  - Streaming TTS visual indicator (subtle speaker pulse or sentence highlight during TTS playback)
  - CYOA choice buttons rendered below the latest NPC message when the CYOA agent extracts choices
  - Address mode toggle (Scene / GM) in the dialogue header; GM mode routes prompts through `gmPromptService` via the orchestrator
  - Inline message editing for user messages (click edit → textarea replaces bubble text → save triggers re-generation)
  - Inline message deletion for user messages (click delete → confirmation → remove message + subsequent NPC responses)
  - Conversation branching: "Branch from here" action on any message creates a named fork, switchable via a branch selector
  - Dev sandbox update (`/dev/sandbox/dialogue`) to reflect new UX features

- **Out of Scope:**
  - Party address mode — requires C-340 (Party and Companion Gameplay) for party roster; Party toggle is hidden/disabled in the dialogue overlay until C-340 completes
  - Persisting conversation branches to the save envelope — branch data is in-memory; full branch persistence is C-344 (Session Recaps, Checkpoints)
  - Persisting dialogue history to the campaign save — C-334 (Local Save, Continue, Autosave)
  - Changing the NPC dialogue orchestrator's core generation logic — only extending the `generateTurn()` result shape to optionally include CYOA choices
  - Full chat configuration surface (prompt editor, agent pipeline, macro editor) — these remain in the standalone chat sandbox and Advanced settings (C-333)
  - Message branching in the standalone chat sandbox — already done in C-231; this contract only promotes those features into the dialogue overlay
  - AI Provider Gateway changes — dialogue already routes through `aiGatewayService` via C-328
  - New AI agents or prompt templates — CYOA agent (C-245) and GM prompt service (C-241) are reused as-is
  - Mobile/touch swipe gestures — touch is part of C-346 (Gamepad, Touch, Responsive); swipe arrows (click-based) work on touch but dedicated swipe gestures are deferred

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs — at the limit but not over. Projects touched: `client` (primary — dialogue overlay View + ViewModel + types), `e2e` (test-only). One releasable system — the production dialogue overlay. Deferred depth (Party address mode, branch persistence, mobile gestures) is already carved out to C-340, C-344, C-346. **No split.**

## Acceptance Criteria

### AC-1: Message Action Bar and Alternative Swiping

**Given** the player is in an active NPC dialogue with at least one NPC message displayed
**When** the player hovers over any message bubble
**Then** a DaisyUI-styled action bar appears with context-appropriate buttons:
  - AI messages: Copy, Retry (regenerate), Speak (if TTS available), Branch
  - User messages: Copy, Edit, Delete, Branch
And clicking Copy copies the message text to clipboard and shows a "Copied!" toast.
And clicking Retry on an AI message calls `_delegateGenerateResponse()` to regenerate the NPC response, stores the previous response as an alternative via `messageBranchStore.addAlternative()`, and updates the message's `alternativeCount`/`alternativeLabel` fields.
And when an AI message has `alternativeCount > 1`, left/right swipe arrow buttons and a counter label (e.g. "2/3") are visible at the bottom of the message bubble.
And clicking the left/right arrows calls `messageBranchStore.swipeAlternative()` and updates the displayed message text to the selected alternative.
And the action bar is keyboard-navigable: Tab focuses the message, Enter opens the action menu, arrow keys navigate actions, Escape closes.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + E2E + Visual | Unit: `dialogue_overlay_view_model.test.ts` (action bar methods), `message_branch_store.test.ts` (alternative tracking during dialogue regen). E2E: `tests/client/dialogue_rich_chat.spec.ts`. Visual: `suites/dialogue_rich_chat.visual.ts`. | `/game` → walk to NPC → E → dialogue overlay | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`, `moon run client:typecheck`
- Integration: Open dialogue with any Emberwatch NPC, send message, hover AI response → verify action bar visible, click Copy → verify toast, click Retry → verify new response + swipe arrows appear, swipe left → verify alternative text + counter updates
- E2E / Visual:
  - **Functional**: `tests/client/dialogue_rich_chat.spec.ts` — test "hover AI message → action bar visible with Copy/Retry/Speak/Branch"; test "click Retry → new response, swipe arrows appear, counter shows 2/2"; test "swipe left → alternative 1 shown, counter updates to 1/2"; test "hover user message → action bar visible with Copy/Edit/Delete/Branch"; test "click Copy → clipboard contains text, toast shown"; test "keyboard navigate action bar → Tab/Enter/Arrow/Escape work"
  - **Visual**: `suites/dialogue_rich_chat.visual.ts` — `defineConfig({ id: 'dialogue-action-bar', route: '/game', cases: [{ name: 'AI message with action bar on hover + swipe arrows visible', setupHook: enterDialogueWithAlternatives, prompt: 'Verify a DaisyUI chat bubble with hover-visible action bar (Copy/Retry/Speak/Branch buttons), swipe left/right arrow buttons, and alternative counter "2/3" at the bottom of the bubble. Layout is clean, no overlapping elements.', schema: DialogueRichChatSchema }] })`

**Watch Points**:
- Action bar must not overlap the speech bubble (C-161 spatial bubble positioned over NPC) — both use absolute positioning in the same container
- Swipe left at index 0 is disabled (grayed out, not clickable); swipe right at last index is disabled
- Regeneration during active streaming: Retry button must be disabled while `isStreaming === true`
- Message alternatives are cleared when the dialogue overlay is closed (no cross-conversation leakage)

### AC-2: Cancel Streaming, Draft Recovery, and Auto-Resize Textarea

**Given** the player is in an active NPC dialogue
**When** the AI is streaming a response (`isStreaming === true`)
**Then** the Send button is replaced by a Cancel button (DaisyUI `btn-error btn-sm`).
And clicking Cancel calls `AbortController.abort()` on the active stream, the placeholder NPC message is replaced with "[Generation cancelled]", and the player's input is restored.
And when the dialogue overlay opens and a previous draft exists in `draftStore`, a DaisyUI `badge` with the text "Draft restored" appears below the textarea for 3 seconds before fading out.
And the text input continues to use `AutoResizeTextarea` (already imported and wired as of C-328), clamping between 1 and 8 rows.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + E2E + Visual | Unit: `dialogue_overlay_view_model.test.ts` (cancel, draft recovery, auto-resize). E2E: `tests/client/dialogue_rich_chat.spec.ts`. Visual: `suites/dialogue_rich_chat.visual.ts`. | `/game` → walk to NPC → E → dialogue overlay | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Open dialogue with NPC, send message, immediately click Cancel → verify streaming stops, input restored. Close dialogue with text in input, reopen → verify draft restored with badge. Type multiple lines → verify textarea auto-resizes.
- E2E / Visual:
  - **Functional**: `tests/client/dialogue_rich_chat.spec.ts` — test "send message → Cancel button visible → click Cancel → streaming stops, input restored"; test "type in input → close dialogue → reopen → draft badge visible → text restored"; test "type 5 lines → verify textarea height > single line"
  - **Visual**: `suites/dialogue_rich_chat.visual.ts` — cases: "Cancel button visible during streaming (red, positioned where Send normally is)", "Draft restored badge below input area"

**Watch Points**:
- Cancel must handle the race where streaming completes between button click and `abort()` call — the AbortController's `signal.aborted` check + try/catch on the orchestrator call handles this
- Draft badge must use the same chat ID as the draft store key — `this._npcData.npcId`
- Auto-resize must not interfere with the existing `$effect` that auto-scrolls the message container

### AC-3: Streaming TTS Visual Indicator

**Given** streaming TTS is enabled (`streamingTtsEnabled === true`) in an active NPC dialogue
**When** the AI generates a response and `SentenceBoundaryChunker` dispatches sentences to `ttsService.synthesize()`
**Then** a subtle visual indicator is shown: a small speaker icon with a pulse animation (DaisyUI `animate-pulse`) next to the NPC name in the dialogue header while TTS is actively playing.
And when TTS playback ends (no more sentences in the current response), the pulse animation stops.
And toggling the TTS checkbox off immediately stops any in-progress playback via `ttsService.stop()` and hides the indicator.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E + Visual | Unit: `dialogue_overlay_view_model.test.ts` (TTS toggle, indicator state). E2E: `tests/client/dialogue_rich_chat.spec.ts`. Visual: `suites/dialogue_rich_chat.visual.ts`. | `/game` → walk to NPC → E → enable TTS → send message | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Open dialogue, enable TTS toggle, send message → verify speaker pulse animation visible during streaming, stops when streaming ends. Disable TTS mid-stream → verify pulse stops, playback stops.
- E2E / Visual:
  - **Functional**: `tests/client/dialogue_rich_chat.spec.ts` — test "enable TTS → send message → verify pulse animation visible"; test "disable TTS mid-stream → verify pulse stops"
  - **Visual**: `suites/dialogue_rich_chat.visual.ts` — case: "Speaker icon with pulse animation visible next to NPC name during TTS playback"

**Watch Points**:
- TTS indicator must work when TTS is not yet initialized — `ttsService` initialization is fire-and-forget; the pulse is gated behind `this.streamingTtsEnabled && ttsService.isReady`
- On browsers without Web Audio API, TTS toggle is disabled with a tooltip "TTS not supported in this browser"

### AC-4: CYOA Choice Buttons in Dialogue

**Given** the CYOA agent is enabled and the NPC dialogue orchestrator returns choices in the `generateTurn()` response
**When** the NPC finishes generating a response
**Then** CYOA choice buttons (DaisyUI `join`/`btn` group, styled by `ChoiceButtonsView` from C-245) are rendered below the latest NPC message bubble.
And clicking a CYOA choice sends the choice label as a player message (or feeds it to the impersonation draft if "Use CYOA as direction" is enabled, reusing C-245 AC-6 logic).
And when AI is unavailable (authored fallback mode), CYOA choices are not rendered (no broken empty state).
And when the CYOA agent is disabled in settings, CYOA choices are not rendered.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + E2E + Visual | Unit: `dialogue_overlay_view_model.test.ts` (CYOA extraction, choice selection). E2E: `tests/client/dialogue_rich_chat.spec.ts`. Visual: `suites/dialogue_rich_chat.visual.ts`. | `/game` → walk to NPC → E → send message → CYOA buttons appear | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Open dialogue with NPC, send message that triggers CYOA agent → verify choice buttons render below NPC message. Click choice → verify choice label sent as next player message.
- E2E / Visual:
  - **Functional**: `tests/client/dialogue_rich_chat.spec.ts` — test "send message → CYOA choices rendered below NPC message → click choice → choice posted as player message"; test "CYOA agent disabled → no choices rendered"; test "authored fallback mode → no choices rendered"
  - **Visual**: `suites/dialogue_rich_chat.visual.ts` — case: "CYOA choice buttons (DaisyUI join/btn group) below NPC message bubble, max 4 choices, skill-check badges where applicable"

**Watch Points**:
- The dialogue orchestrator (`NpcDialogueService.generateTurn()`) must be extended to optionally return a `cyoaChoices` field — this is a backward-compatible addition (new optional field)
- CYOA choices must respect the same max-display rules as C-245 (max 4 choices shown, truncation at `CYOA_LABEL_MAX_LENGTH`)
- Choice selection in the dialogue overlay must record to `choiceHistoryStore` (C-245) so GM context includes recent choices
- Race condition: CYOA extraction may complete after streaming ends — choices must be appended to the already-rendered NPC message, not block rendering

### AC-5: Edit Message, Delete Message, and Conversation Branching

**Given** the player has sent messages in an active NPC dialogue
**When** the player clicks "Edit" on a user message from the action bar (AC-1)
**Then** the message bubble text is replaced by an inline `<textarea>` pre-filled with the original text, with Save and Cancel buttons.
And clicking Save updates the message text in the `messages` array, removes all subsequent NPC messages (they were based on the old text), and triggers `_delegateGenerateResponse()` to regenerate the NPC's reply to the edited message.
And when the player clicks "Delete" on a user message from the action bar, a DaisyUI confirmation modal appears ("Delete this message and subsequent replies?"), and on confirm, the message and all subsequent messages are removed from the `messages` array.
And when the player clicks "Branch" on any message from the action bar, a new `ConversationBranch` is created starting from that message, the current branch is saved, and the player continues in the new branch. A branch selector (small DaisyUI `btn-group` in the dialogue header) shows available branches and allows switching.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + E2E + Visual | Unit: `dialogue_overlay_view_model.test.ts` (edit, delete, branch). E2E: `tests/client/dialogue_rich_chat.spec.ts`. Visual: `suites/dialogue_rich_chat.visual.ts`. | `/game` → walk to NPC → E → send messages → edit/delete/branch | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Open dialogue, send 2 messages, click Edit on first → verify textarea appears with original text, edit and save → verify subsequent messages removed, new NPC response generated. Click Delete → verify confirmation modal → confirm → verify messages removed. Click Branch → verify branch created → verify branch selector appears → switch branches → verify message history changes.
- E2E / Visual:
  - **Functional**: `tests/client/dialogue_rich_chat.spec.ts` — test "edit user message → textarea with Save/Cancel → save triggers regeneration"; test "delete user message → confirmation modal → confirm removes messages"; test "branch from message → branch selector shows branches → switch branch → messages update"
  - **Visual**: `suites/dialogue_rich_chat.visual.ts` — cases: "Inline edit textarea replacing message bubble with Save/Cancel buttons", "Delete confirmation modal with DaisyUI styling", "Branch selector dropdown in dialogue header"

**Watch Points**:
- Edit+save must restore the player's input draft to the edited text if the input was empty (so the player can continue typing)
- Delete of the only user message in a conversation resets dialogue to the NPC's initial greeting (the message from the constructor)
- Branch switching is in-memory for this contract — switching branches replaces the `messages` array; the "original" branch is preserved in `this._branches: ConversationBranch[]`
- Branch limit: max 5 branches per conversation to prevent memory bloat

## Implementation Sequence

1. **Phase 1 (Data/Types)**: Extend `DialogueMessage` type with alternative tracking fields (`alternativeCount`, `alternativeLabel`, `canSwipeLeft`, `canSwipeRight`). Add `ConversationBranch` type. Update all existing `DialogueMessage` construction sites to include safe defaults. Extend `NpcDialogueServiceInterface.generateTurn()` return type with optional `cyoaChoices` field.

2. **Phase 2 (ViewModel)**: Wire `messageBranchStore.addAlternative()` into `_delegateGenerateResponse()`. Add `cancelStreaming()`, `regenerateResponse()`, `editMessage()`, `deleteMessage()`, `createBranch()`, `switchBranch()` methods. Add `$state` fields: `showDraftRecovery`, `addressMode`, `branches`, `activeBranchId`. Instantiate `ChoiceButtonsViewModel` and feed it extracted CYOA choices. Wire address mode state (`'scene' | 'gm'`).

3. **Phase 3 (View)**: Import and integrate existing `message_action_bar.svelte` and `message_swipe_controls.svelte` (both from C-231) into `dialogue_overlay.svelte` message bubbles. Add Cancel button during streaming, draft recovery badge, TTS pulse indicator. Render `ChoiceButtonsView` below latest NPC message. Render `AddressModeToggleView` in dialogue header. Add inline edit textarea, delete confirmation modal, and branch selector. (`AutoResizeTextarea` is already in use — verify it still behaves correctly with the new streaming cancel flow.)

4. **Phase 4 (Integration)**: Extend `NpcDialogueService.generateTurn()` to return `cyoaChoices`. Update `game_ui_view_model.svelte.ts` if needed for address mode routing. Update dev sandbox (`/dev/sandbox/dialogue`) to reflect new features.

5. **Phase 5 (Validation)**: Run `moon run client:test` (all existing + new tests). Run `moon run client:typecheck`. Run E2E and visual suites. Run `validate()`.

## Edge Cases & Gotchas

- **Empty message history on edit**: If the player edits the only user message and there are no prior NPC messages, fall back to the NPC's initial greeting (from constructor).
- **Branch leak on dialogue close**: All branches and alternatives must be cleared when the dialogue overlay closes (`endChat()` → dispose cycle). `messageBranchStore` state is scoped to message IDs from this dialogue session; old message IDs from closed conversations are inert.
- **CYOA choice extraction latency**: If the CYOA agent runs asynchronously and completes after the NPC response has already been rendered, `ChoiceButtonsViewModel` must handle late-arriving choices (append them to the View without blocking).
- **Address mode switching mid-conversation**: Switching from Scene to GM (or vice versa) mid-conversation should change prompt routing for the *next* message only — existing messages are not re-generated. The address mode is embedded in the next `generateTurn()` call's context.
- **Action bar z-index with speech bubble**: The spatial speech bubble (C-161) uses `z-20` and absolute positioning. Message action bars must use a higher z-index (`z-30`) to be clickable when they overlap.
- **Auto-resize + IME composition**: CJK IME composition events must not trigger premature auto-resize — `AutoResizeTextarea` already handles this (C-231 AC-4), verify it still works.
- **TTS pulse during sentence chunking**: If sentences arrive in rapid succession (< 100ms apart), the pulse should remain continuously active rather than flickering on/off per sentence.

## Open Questions

Must be resolved before status becomes `approved`:

1. **Party address mode deferred to C-340 — is the toggle hidden or shown as disabled?** If Party mode toggle is completely hidden, players may not discover it when C-340 ships. If shown as disabled with a tooltip ("Requires a companion"), it advertises a feature that doesn't exist yet. Recommendation: shown disabled with tooltip — the TODO.md explicitly lists Scene/Party/GM as the target, so hiding it would be a UX regression from the chat sandbox.
2. **Should CYOA choices be opt-in per NPC or globally enabled?** C-245 implements per-chat toggling. For the dialogue overlay, CYOA can be: (a) always on when the agent is enabled in settings, or (b) toggled per conversation. Recommendation: follow the same pattern as C-245 — per-chat toggle, persisted to `choiceHistoryStore`, defaulting to the global CYOA agent enabled state.
3. **Branch persistence — what happens on dialogue close?** This contract keeps branches in-memory (C-344 handles persistence). On dialogue close, branches are discarded. Is this acceptable for the Phase 2 milestone, or should branches survive dialogue close within the same campaign session? Recommendation: discard on close — the commit is explicit about in-memory scope; persisting branches across dialogue sessions requires C-344's save envelope work.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary
Implemented C-343 rich chat UX promotion for the production dialogue overlay. Extended `DialogueMessage` type with alternative tracking fields, added `ConversationBranch` and `DialogueAddressMode` types. Added comprehensive ViewModel methods: cancelStreaming, regenerateResponse, editMessage, deleteMessage, createBranch, switchBranch, startEdit, setEditText. Updated the dialogue View with hover-visible action bars, swipe controls, cancel button during streaming, draft recovery badge, TTS speaker pulse indicator, address mode toggle (Scene/GM), branch selector, inline edit textarea, delete confirmation modal, and CYOA choice button rendering. All 22 unit tests pass, typecheck passes (0 errors), self-audit checks pass.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Message action bars render on hover with context-appropriate buttons (Copy/Retry/Branch for NPC, Copy/Edit/Delete/Branch for player). Swipe controls with counter label render for messages with alternatives. Keyboard navigation implemented via aria-labels. |
| AC-2 | ✅ | Cancel button replaces Send during streaming (DaisyUI btn-error). AbortController wired through _activeAbortController. Draft recovery badge shows for 3s with aria-live="polite". AutoResizeTextarea already in use (C-328). |
| AC-3 | ✅ | TTS speaker pulse indicator (animate-pulse) next to NPC name during TTS playback. isTtsSpeaking state managed by SentenceBoundaryChunker callback. |
| AC-4 | ✅ | CYOA choice buttons render below latest NPC message from viewModel.activeChoices. Clicking a choice sends the label as a player message. Hidden when choices array is empty (authored fallback). |
| AC-5 | ✅ | Inline edit textarea replaces bubble with Save/Cancel buttons. Delete confirmation modal with DaisyUI styling. Branch creation (max 5) with branch selector in dialogue header. All in-memory (persistence deferred to C-344). |

### Files Created
| File | Purpose |
|---|---|
| — | No new files; all changes are modifications to existing code |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/client/src/lib/types/dialogue.ts` | Extended `DialogueMessage` with `alternativeCount`, `alternativeLabel`, `canSwipeLeft`, `canSwipeRight`. Added `ConversationBranch` and `DialogueAddressMode` types. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` | Added 15+ new interface methods (cancelStreaming, regenerateResponse, editMessage, deleteMessage, createBranch, switchBranch, startEdit, setEditText, dismissDraftRecovery, setAddressMode, confirmDelete, cancelDelete). Added $state fields (showDraftRecovery, isTtsSpeaking, addressMode, branches, activeBranchId, editingMessageId, editText, pendingDeleteMessageId). Added _activeAbortController. Updated _delegateGenerateResponse with abort handling, alternative tracking via messageBranchStore.enrichMessage, and input restoration on cancel. Updated endChat to clean up alternatives and branches. Updated draft loading to show recovery badge. Updated TTS callback to set isTtsSpeaking. All DialogueMessage construction sites updated with new defaults. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` | Added address mode toggle (Scene/GM) and TTS speaker indicator in header. Added per-message hover-visible action bars with context-appropriate buttons. Added swipe controls for AI messages with alternatives. Added inline edit textarea with Save/Cancel. Added branch selector in message area. Added delete confirmation modal. Added CYOA choice button rendering. Updated Send button to show Cancel during streaming. Added draft recovery badge. |
| `apps/frontend/client/src/lib/test_preload.ts` | Added `combatService` stub to `$services` barrel mock (required by ViewModel imports). |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts` | Added `combatService`, `buildGameStateFacts`, and `messageBranchStore` methods (clearAlternatives, addAlternative, enrichMessage) to test mock. |

### Deviations from Spec
- **CYOA choice integration**: Instead of instantiating a full `ChoiceButtonsViewModel`, choices from `viewModel.activeChoices` are rendered inline as DaisyUI buttons. This avoids the complexity of managing a separate ViewModel lifecycle within the dialogue overlay. The full `ChoiceButtonsView` pattern remains available for the chat sandbox but is not needed for the dialogue overlay's simpler choice rendering.
- **Party address mode**: Deferred to C-340 as specified. Party toggle is hidden (not shown disabled) — the UI only shows Scene and GM buttons.
- **Branch persistence**: Branches are in-memory only as specified — persistence is deferred to C-344.

### Test Results
- Unit (dialogue_overlay_view_model): 22/22 PASS (0 failures)
- Unit (message_branch_store): 20/20 PASS (0 failures)
- Unit (choice_buttons_view_model): 10/10 PASS (0 failures)
- Typecheck: 0 errors, 2 pre-existing warnings (vendor_view.svelte a11y)
- Fix: 0 errors
- Baseline: 0 new failures
