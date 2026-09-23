---
id: C-547
title: "Compact dialogue stage on game UI roles"
source: direct
contract_type: thin
status: implemented
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: "https://github.com/BearlySleeping/aikami/pull/389" }
created_at: "2026-09-23T00:00:00Z"
---

# Contract C-547: Compact dialogue stage on game UI roles

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/reference/emberwatch-polish-review-and-plan.md` §6 “Dialogue” + “Theme and layout discipline” (P4, dialogue surface group) |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/` — the in-game dialogue overlay; `packages/frontend/theme/src/lib/aikami_game_ui.css` — game-UI roles |
| **Type** | thin |
| **Priority** | P1 — the dialogue surface is the most-used player task in P4 and currently shows a short line inside a fixed 45vh box |
| **Dependencies** | C-424 (shared RichMessageList / GuidedComposer), C-543 (game-scoped roles), C-529 (theme scope) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal — no player-facing docs change; the dialogue surface keeps every capability |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the campaign dialogue overlay (`dialogue_overlay.svelte`, mounted by `game_ui_view.svelte`) |

## Problem & Baseline Evidence

- **Current behavior**: `dialogue_overlay.svelte` renders a detached 112px
  portrait row, a fixed `h-[45vh]` chat panel (full view: `calc(100dvh-2rem)`),
  and the legacy `base-*`/`primary`/`modal-box`/`alert`/`badge` surface language.
  A single short line therefore sits inside a tall, mostly empty box, and the
  composer competes with the message region for height.
- **Reproduction**: open the dev sandbox `/dev/sandbox/dialogue` (or `/game` and
  approach an NPC) with a one-line greeting; the conversation region is a fixed
  45vh regardless of content.
- **Existing implementation to reuse**: the shared `RichMessageList`,
  `RichMessageRow`, `GuidedComposer`, `GameDice`, `CapabilityErrorBanner`,
  `SlashAutocomplete` and `PendingMessageBanner` components (C-424); the game-UI
  roles in `aikami_game_ui.css` (C-543); the `[data-aikami-theme-scope]` root
  (C-529).
- **Known gaps**: no content-sized transcript; no viewport-relative cap; detached
  speaker row; view-local presentation logic; `base-*` surface language; “End
  Chat” styled as destructive (`text-error`).
- **Baseline tests**: `dialogue_overlay_view_model.test.ts`,
  `dialogue_overlay_provenance.test.ts`, `dialogue_pending_queue.test.ts`,
  `dialogue_check_provenance.test.ts`, the visual suites
  `dialogue_streaming` / `dialogue_fallback` / `dialogue_slash_commands` /
  `cyoa_choices`, and the client E2E dialogue specs.

## User Outcome

After this contract, a player reads a short NPC line in a compact bottom stage
whose speaker identity is attached to the transcript, with the composer always
on screen — including during long streaming replies and at compact viewports or
200% text — and the whole surface uses the game’s own surface roles.

## Scope Boundaries

- **In Scope:** restructure the dialogue overlay into one compact bottom stage
  (speaker identity in the header, one content-sized transcript capped relative
  to the viewport, always-visible composer); keep full view on the same toggle;
  render choices/chips/dice/banners/images/recruitment inline in the transcript;
  replace `base-*`/`primary` with game-UI roles and add the minimum new roles
  (stage, scrim, neutral control, chip intents, toggle) to `aikami_game_ui.css`;
  move the view-local presentation logic into a sibling pure module; extend the
  dialogue visual suites for the new states/matrix; unit-test the new module.
- **Out of Scope:** management/pause/HUD surfaces; provider/AI logic; new theme
  engine; global override stylesheet; deploy; any ViewModel behaviour change
  beyond moving presentation logic (the 3,062-line ViewModel may not grow).

## Acceptance Criteria

### AC-1: Content-sized compact stage with an always-visible composer
**Given** the dialogue overlay is open with one short line
**When** it renders
**Then** the stage is short (sized to its content), not a fixed 45vh box, and the
composer is visible; with a long streaming reply the transcript scrolls while the
composer stays visible.

**Verification**: `/game` (and `/dev/sandbox/dialogue`) — visual cases
`dialogue_streaming` → `short_line_default_1280x720`, `long_streaming_reply`,
`compact_800x600`, `text_200pct`; the transcript is the single scroll owner
(`.game-stage__transcript`) and the composer is `flex: 0 0 auto`.

### AC-2: Speaker identity attached to the stage header
**Given** an NPC is speaking
**When** the stage renders
**Then** the NPC portrait (56–64px) and name appear in the stage header, and no
detached full-width avatar row is rendered; companion/player identity is shown
compactly inline by the shared row.

**Verification**: `/game` — `dialogue_overlay.svelte` header
(`.game-stage__portrait` / `.game-stage__identity`); the detached avatar row is
removed; `RichMessageRow` keeps the inline party identity (`showPartyUi`).

### AC-3: Full view remains reachable from the same toggle
**Given** the compact stage
**When** the player activates the full-view toggle
**Then** the stage expands (reusing the viewport cap) and the toggle returns to
compact; the toggle keeps its accessible name and pressed state.

**Verification**: visual `dialogue_streaming` → `full_view`; the toggle is
`aria-pressed` with `Enter full view` / `Exit full view` labels.

### AC-4: Inline capabilities are preserved
**Given** a conversation that produces CYOA choices, suggestion chips, a dice
roll banner, pending/interrupted banners, generated images or a recruitment offer
**When** each state occurs
**Then** it renders inline in the transcript (not as a screen-covering overlay or
a composer replacement) and remains reachable by keyboard.

**Verification**: `data-testid="cyoa-choices"`, `suggestion-chips`,
`pending-queue-banner`, `interrupted-check-banner`, `dialogue-streaming-text`
are preserved; visual `dialogue_streaming` → `dice_skill_check`, `cyoa_choices`
→ `CYOA Choices — Dialogue Stage`, `dialogue_slash_commands`; existing E2E
`dialogue_chips.spec.ts` / `dialogue_tts_toggle.spec.ts`.

### AC-5: Game-UI surface roles replace the legacy surface language
**Given** the dialogue overlay
**When** it renders inside `[data-aikami-theme-scope]`
**Then** its chrome uses `game-surface` / `game-surface--raised` /
`game-surface--inset` / `game-narrative` / `game-metadata` /
`game-section-title` / the focus-ring token, plus the minimum new roles
(`game-stage*`, `game-scrim`, `game-control--neutral`, `game-chip--*`,
`game-toggle`) added to `aikami_game_ui.css`; no new theme engine or global
override sheet is introduced.

**Verification**: `aikami_game_ui.css` (`@layer components`, scoped under
`[data-aikami-theme-scope]`); `frontend-theme:test` / `:typecheck`; visual
`theme_dark`.

### AC-6: View-local presentation logic moves out of the View
**Given** the overlay View
**When** it renders
**Then** the fullscreen flag, RichMessage projection, chip class/icon mapping,
row-action dispatch table and the Escape-scope handler live in
`dialogue_stage_presentation.svelte.ts`, and the production ViewModel does not
grow.

**Verification**: `dialogue_stage_presentation.test.ts` (behavioural);
`guard-source-file-size` still passes with the ViewModel at its baseline.

### AC-7: Keyboard behaviour — one Escape scope at a time
**Given** the delete-confirmation modal is open (non-campaign)
**When** the player presses Escape
**Then** the modal closes and the conversation stays open; with no modal, Escape
dismisses the slash-autocomplete popup first and otherwise ends the chat; focus
returns to the game after End Chat (existing host behaviour).

**Verification**: `dialogue_stage_presentation.test.ts` (`createStageEscapeHandler`);
`dialogue_overlay_view_model.test.ts` (slash-scope Escape); E2E
`dialogue_branching_gating.spec.ts`.

### AC-8: “End Chat” is a neutral control
**Given** the stage header
**When** the player looks at “End Chat”
**Then** it is a neutral control (`.game-control--neutral`, no `text-error`) and
still reachable by Escape.

**Verification**: `dialogue_overlay.svelte` header; visual
`short_line_default_1280x720`.

## Capability Checklist

Each capability must still work after the restructure. “Verified by” names the
test or file that covers it; existing tests are marked (existing).

| Capability | Still works? | Verified by |
|---|---|---|
| Free text | ✅ | View composer → `setInput`/`sendMessage`; `dialogue_overlay_view_model.test.ts` (existing) |
| CYOA choices | ✅ | `after` snippet `data-testid="cyoa-choices"`; visual `cyoa_choices` → dialogue-stage case |
| Streaming + cancel | ✅ | `RichMessageRow` streamingText + `GuidedComposer` onCancel; `dialogue_overlay_view_model.test.ts` (existing) |
| Retry / rephrase / regenerate | ✅ | `dispatchDialogueRowAction` `retry` → `rephraseResponse`; `dialogue_stage_presentation.test.ts`; VM tests (existing) |
| Pending retry banner | ✅ | `PendingMessageBanner` in `after`; `dialogue_pending_queue.test.ts` (existing) |
| Interrupted-check resume/dismiss | ✅ | `after` snippet; `dialogue_overlay_provenance.test.ts` (existing) |
| TTS toggle + speak + indicator | ✅ | `extras` snippet + `speak` action; `dialogue_tts_toggle.spec.ts` (existing) |
| Combat chips / `startCombat` | ✅ | `game-chip--danger` → `handleChipTap`; `dialogue_overlay_view_model.test.ts` (existing) |
| Recruitment | ✅ | recruit offer in `after` (`data-testid="recruit-offer"`); VM tests (existing) |
| Skill checks / dice | ✅ | `GameDice` in `after`; `dialogue_overlay_view_model.test.ts` (existing); visual `dice_skill_check` |
| Quest accept / decline | ✅ | VM tests (existing) |
| Image generation | ✅ | `imageBlock` snippet; visual `dialogue_slash_commands` |
| Slash commands + autocomplete | ✅ | `SlashAutocomplete` + composer; `chat_modes.spec.ts` (existing) |
| Address mode (scene/GM) | ✅ | dev sandbox devtools (unchanged) |
| Full-view toggle | ✅ | `createDialogueStageState`; visual `full_view` |
| End conversation + Escape | ✅ | header End Chat; `handleKeyDown` (existing) + `createStageEscapeHandler` |
| Branch / edit / delete (non-campaign) | ✅ | `RichMessageRow` + `dispatchDialogueRowAction`; `dialogue_stage_presentation.test.ts`; `dialogue_branching_gating.spec.ts` (existing) |
| Suggestion chips | ✅ | `after` chips (`data-testid="suggestion-chips"`); `dialogue_chips.spec.ts` (existing) |
| Draft recovery | ✅ | `extras` badge; VM tests (existing) |
| Expression | ✅ | dev sandbox devtools (unchanged) |
| Capability error banner + go-to-settings | ✅ | `CapabilityErrorBanner` in `after`; VM tests (existing) |

## Edge Cases & Gotchas (optional)

- **The ViewModel must not grow**: `guard-source-file-size` baselines
  `dialogue_overlay_view_model.svelte.ts` at 3,062 lines and refuses growth. The
  fullscreen flag therefore lives in a tiny presentation sub-VM, not the
  ViewModel.
- **Sandbox theme scope**: `/dev/sandbox/dialogue` does not sit under
  `[data-aikami-theme-scope]`; the overlay root declares the attribute itself so
  the game roles apply identically in the sandbox and on `/game`.
- **Shared row selectors**: `RichMessageRow` bubble classes
  (`.rounded-bl-md.bg-base-100`, `.rounded-br-md.bg-primary`) are used by the
  `DialoguePage` POM and are intentionally left unchanged.
- **Scroll anchoring**: the transcript projection creates a fresh row array each
  render; the shared list’s scroll effect remains idempotent (it only writes
  `scrollTop`).

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

Reworked the in-game dialogue overlay into a single compact bottom stage: the
speaker portrait/name moved into the stage header, the transcript became one
content-sized scroll region capped relative to the viewport (no fixed 45vh), and
the composer is always visible. CYOA choices, suggestion chips, dice/roll
banners, pending/interrupted banners, generated images and the recruitment offer
now render inline in the transcript. The legacy `base-*`/`primary` surface
language was replaced with game-UI roles, adding the minimum new roles to
`aikami_game_ui.css` (`game-stage*`, `game-scrim`, `game-control--neutral`,
`game-chip--*`, `game-toggle`). The View’s local logic (fullscreen flag,
RichMessage projection, chip mapping, row-action dispatch, Escape scope) moved
into `dialogue_stage_presentation.svelte.ts` with behavioural unit tests; the
production ViewModel was not modified.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Content-sized stage + always-visible composer; `max-block-size` cap. |
| AC-2 | ✅ | Portrait + name in `.game-stage__header`; detached avatar row removed. |
| AC-3 | ✅ | `createDialogueStageState` + `game-stage--full`. |
| AC-4 | ✅ | Inline transcript capabilities; test ids preserved. |
| AC-5 | ✅ | Game roles + minimal additions; no new theme engine. |
| AC-6 | ✅ | Logic moved to `dialogue_stage_presentation.svelte.ts`; VM unchanged at 3,062 lines. |
| AC-7 | ⚠️ | Slash scope (existing) + delete-modal scope via `createStageEscapeHandler`; verified by unit test, not yet by a production keyboard E2E. |
| AC-8 | ✅ | `game-control--neutral`, no `text-error`. |

### Files created / modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_stage_presentation.svelte.ts` | **created** — pure presentation helpers + stage sub-VM |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_stage_presentation.test.ts` | **created** — 21 behavioural tests |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` | **modified** — compact stage restructure |
| `packages/frontend/theme/src/lib/aikami_game_ui.css` | **modified** — minimum game-stage roles |
| `apps/e2e/src/visual/suites/dialogue_stage_fixtures.ts` | **created** — shared stage-review matrix helpers |
| `apps/e2e/src/visual/suites/dialogue_streaming.visual.ts` | **modified** — added stage matrix cases |
| `apps/e2e/src/visual/suites/dialogue_fallback.visual.ts` | **modified** — compact + 200% cases |
| `apps/e2e/src/visual/suites/dialogue_slash_commands.visual.ts` | **modified** — compact case |
| `apps/e2e/src/visual/suites/cyoa_choices.visual.ts` | **modified** — dialogue-stage choices case |

### Deviations from spec + rationale

- **`cyoa_choices` route**: the suite targets the standalone `/dev/cyoa`
  component, not the dialogue stage. A new case navigates to
  `/dev/sandbox/dialogue` inside its `setupHook` (the same pattern
  `dialogue_fallback` uses for its production case) so the choices are reviewed
  in their real host; the existing `/dev/cyoa` cases are unchanged.
- **200% text / theme**: applied through the product’s real mechanisms
  (`document.documentElement.style.fontSize`, `data-theme`) rather than new
  framework options.
- **AC-7 delete-modal scope**: implemented without growing the ViewModel
  (`createStageEscapeHandler`), because the ViewModel is at its source-size
  baseline.
- **Dialogue visual suites were already red**: all four used
  `waitCondition: 'game_ready'` on a DOM-only sandbox with no canvas, so every
  case timed out in `_waitForGameReady` before capture. The suites now declare
  `waitSelector: '[data-testid="dialogue-overlay"]'`, which fixes the sandbox
  cases. `dialogue_fallback`'s pre-existing `authored-fallback-production` case
  still times out: it navigates to `/game` and walks to an NPC, which does not
  reliably open the overlay in a headless capture run. It is left as-is (not a
  C-547 regression) rather than weakened.
- **`DialoguePage` POM selectors**: the shared `RichMessageRow` bubble classes
  (`.rounded-bl-md.bg-base-100`, `.rounded-br-md.bg-primary`) and the
  `dialogue-overlay` / `suggestion-chips` / `cyoa-choices` /
  `interrupted-check-banner` test ids are preserved unchanged.

### Test results

- `client:typecheck` — 0 errors, 0 warnings.
- `client:test` — 4,021 pass / 2 fail on the first run (both in the new test file, an
  event-`defaultPrevented` assertion against the Bun `KeyboardEvent` polyfill),
  fixed; `dialogue_stage_presentation.test.ts` 21/21 on re-run.
- `frontend-theme:test` — 99 pass; `frontend-theme:typecheck` — pass.
- `client:lint`, `e2e lint`, `e2e typecheck` — pass.
- `run_guards.ts` — 10/10 structural guards pass.
- `bun moon ci --base=origin/main` — see the PR checks; run after clearing a
  stale `.moon/cache` left by relocating the worktree.

**Visual capture (capture-only, real client dev server on `127.0.0.1:5274`):**

| Suite | Captured |
|---|---|
| `dialogue_streaming` | 9/9 — short line, long streaming reply, full view, 1280×720, 1920×1080, 800×600, 200% text, dark theme, dice |
| `dialogue_slash_commands` | 2/2 — inline image + compact |
| `cyoa-choices` | 3/3 — standalone + dialogue-stage choices |
| `dialogue_fallback` | 3/4 — the pre-existing `authored-fallback-production` case times out navigating `/game` and walking to an NPC (see Deviations) |

Screenshots (gitignored): `apps/e2e/test-results/visual/dialogue_streaming_*.png`,
`dialogue_slash_commands_*.png`, `cyoa-choices_*.png`, `dialogue_fallback_*.png`.

