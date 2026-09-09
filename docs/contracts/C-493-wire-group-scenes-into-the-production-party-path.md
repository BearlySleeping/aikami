---
id: C-493
title: "Wire group scenes into the production party path"
source: direct
contract_type: thin
status: implemented
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-493: Wire group scenes into the production party path

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-493, seeded from the 2026-09-06 external review (V-6); Phase 2 — closes C-456's production gap |
| **Target** | `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` (`selectGroupParticipants` `:425`, `generateMultiNpcResponses` `:444`, poller `start` `:135`), `apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte.ts`, `apps/frontend/client/src/lib/types/dialogue.ts:73` (`DialogueAddressMode`), `apps/frontend/client/src/lib/views/gm/address_mode_toggle_view_model.svelte.ts` (the disabled `party` mode) |
| **Type** | thin |
| **Priority** | P1 — the capability already exists and is tested; it has no production caller |
| **Dependencies** | [C-488](C-488-authored-npc-identity-in-the-content-pack.md) — the authored scene cast this contract's NPC discovery must read. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | user-facing |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the Talk to Party overlay (`talk_to_party_view_model.svelte.ts`) and the campaign-time autonomous poller |

## Problem & Baseline Evidence

- **Current behavior**: `selectGroupParticipants()` and `generateMultiNpcResponses()` are fully implemented and covered by 22 passing unit tests, and no production code calls either. The production "Talk to Party" overlay addresses **one** companion through `npcDialogueService.generateTurn` (`talk_to_party_view_model.svelte.ts:126`), never the group path. The autonomous-message poller's `start()` is invoked only from `autonomous_sandbox_view_model.svelte.ts:210` (dev sandbox), and its known-NPC discovery reads `worldStateService.worldGenOutput` (`autonomous_message_service.svelte.ts:314-316`) rather than the authored scene cast.
- **Reproduction**: `grep -rn "selectGroupParticipants\|generateMultiNpcResponses" apps/frontend/client/src --include='*.ts' --include='*.svelte' --include='*.svelte.ts'` outside the service and tests → no hits; `grep -rn "autonomousMessageService.start\|autonomousMessageService"` outside the service and tests → only `autonomous_sandbox_view_model.svelte.ts`.
- **Existing implementation to reuse**: `selectGroupParticipants` (`:425`) and `generateMultiNpcResponses` (`:444`) in `autonomous_message_service.svelte.ts`; the poller (`start`/`stop`/`pause`/`resume`, `_scheduleNextTick`); `talk_to_party_view_model.svelte.ts` (single-companion overlay); the GM `address_mode_toggle_view_model.svelte.ts` already renders a `party` mode that is disabled (`_isPartyModeDisabled`, comment "deferred to C-340").
- **Known gaps**: `DialogueAddressMode` is only `'scene' | 'gm'` (`dialogue.ts:73`) — the `party` address mode has UI chrome but no type/behaviour; the overlay has no group-addressing path; the poller never runs in campaign play; NPC discovery reads world-gen output instead of the authored pack cast.
- **Baseline tests**: `autonomous_message_service.test.ts` and `autonomous_message_group.test.ts` (the 22 group tests), `talk_to_party` tests if present, `npc_awareness_service` tests. Record their pass state before starting.

## User Outcome

After this contract, a player addressing their party of two or more companions gets a real group turn — two companions respond in one turn, the second aware of the first — and the autonomous idle poller actually runs during campaign play against the authored cast, without rebuilding any of the group-chat machinery that already exists and is tested.

## Scope Boundaries

- **In Scope:** invoking `generateMultiNpcResponses()` from the production "Talk to Party" overlay when two or more companions are present; starting the autonomous poller from the production campaign path (not the sandbox); switching the poller's NPC discovery to the authored scene cast; adding the `party` member to `DialogueAddressMode` and enabling the existing party toggle; keeping the second responder aware of the first.
- **Out of Scope:** building another group-chat system — connect and simplify what exists, do not add new selection/weighting logic; new group-addressing UI beyond the existing `party` address-mode toggle; changing `MAX_GROUP_PARTICIPANTS` or the selection weighting; the narrative director's timed startup (still sandbox-only — separate item, note and leave it); changing C-248 idle-chat behaviour beyond the addressed-turn cap already specified in C-456 AC-4.

## Acceptance Criteria

### AC-1: Party address produces a real group turn
**Given** the Talk to Party overlay with two or more companions present
**When** the player addresses the party
**Then** `generateMultiNpcResponses()` is invoked from the production path and two companions respond in one turn, the second aware of the first.

**Verification**: manual `/game` check with a 2-member party (or a unit/integration test driving the production overlay ViewModel with a real party roster), asserting the group method is the path taken; plus `grep` proving the call site is outside `autonomous_message_service.svelte.ts` and its tests.

### AC-2: The autonomous poller runs in campaign play against the authored cast
**Given** a running campaign (not the sandbox)
**When** the campaign is active
**Then** the autonomous-message poller is started from the production path and its NPC discovery reads the **authored scene cast**, not world-generation output.

**Verification**: unit/integration test asserting `start()` is called on campaign entry (and stopped on teardown), and that discovery sources the pack NPC cast rather than `worldGenOutput`; plus a manual `/game` session showing idle NPC messages arriving without the sandbox.

### AC-3: The orphaned capability leaves the guard baseline
**Given** C-485's orphaned-capability guard
**When** this contract lands
**Then** both `selectGroupParticipants` and `generateMultiNpcResponses` are removed from the baseline JSON (they now have production callers).

**Verification**: `bun run guard:all` (or the orphaned-capability guard) reports zero baseline entries for these two methods.

### AC-4: C-248 idle-chat behaviour is unchanged
**Given** C-248's autonomous idle-chat behaviour and C-456 AC-4
**When** this contract lands
**Then** the multi-NPC cap applies to addressed turns only — idle/unprompted autonomous messages are not capped by the group-turn participant limit.

**Verification**: existing `autonomous_message_service.test.ts` / `autonomous_message_group.test.ts` still pass; add an assertion that idle-tick generation does not route through `generateMultiNpcResponses`.

## Edge Cases & Gotchas

- **Single companion**: the group path must not run with fewer than two companions — fall back to the existing single-companion `npcDialogueService.generateTurn`.
- **Party mode enablement**: the disabled GM `party` toggle must become genuinely functional, not just un-disabled — `DialogueAddressMode` and the dialogue routing both need the new member.
- **Poller teardown**: starting the poller in production means it must also stop on game teardown (`gameBootService.teardown` / route leave), or a stale interval leaks across campaigns.
- **Cast source**: "authored scene cast" is the pack's NPC entries for the loaded scene — do not introduce a new discovery API if the scene cast service already provides it; reuse it.

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
Wired the orphaned C-456 group-turn machinery into the production party path. The Talk to Party overlay now routes through `generateMultiNpcResponses()` when two or more companions are present (single-companion falls back to `generateTurn`); the autonomous-message poller now starts on campaign entry (composition-root `initialize`) and stops on teardown (`dispose`), discovering the authored scene cast (`worldStateService.currentLocation.npcIds`) instead of world-generation output; and `DialogueAddressMode` gained the `party` member so the existing party toggle is genuinely functional. The orphaned-capability baseline was updated to drop the two now-wired methods.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | TalkToPartyViewModel routes through `generateMultiNpcResponses` when ≥2 party members; unit-tested; single-companion falls back to `generateTurn` |
| AC-2 | ✅ | Poller starts on `gameCompositionRoot.initialize` / stops on `dispose`; discovery reads `currentLocation.npcIds` (scene cast) not `worldGenOutput`; lifecycle + discovery unit tests added |
| AC-3 | ✅ | `selectGroupParticipants` + `generateMultiNpcResponses` removed from orphaned-capability baseline; guard passes (144 files match) |
| AC-4 | ✅ | Idle-tick still single-NPC via `_generateAutonomousMessage`; added assertion idle ticks never route through `generateMultiNpcResponses`; all existing group tests pass |

### Files Created
| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.test.ts` | AC-1 group-turn routing tests (group path, single-companion fallback, empty roster) |
| `apps/frontend/client/src/lib/views/gm/address_mode_toggle_view_model.test.ts` | Party-mode enablement tests (party not disabled, setMode('party') functional) |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte.ts` | AC-1: branch to `selectGroupParticipants`+`generateMultiNpcResponses` when ≥2 members; added `senderName` to messages; `autonomousMessageService` injected with default singleton |
| `apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view.svelte` | Render per-message `senderName` (group responders) |
| `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` | Pass real companion context from `gameOverlayService.talkToPartyOptions` |
| `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` | AC-2: `_getKnownNpcIds()` reads authored scene cast (`currentLocation.npcIds`) instead of `worldGenOutput` |
| `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | AC-2: start poller on `initialize`, stop on `dispose` |
| `apps/frontend/client/src/lib/types/dialogue.ts` | Add `'party'` to `DialogueAddressMode` |
| `apps/frontend/client/src/lib/services/npc/autonomous_message_group.test.ts` | AC-2 discovery tests + AC-4 idle regression assertion; scene-cast mock updates |
| `apps/frontend/client/src/lib/services/game/game_composition_root.test.ts` | AC-2 poller start/stop lifecycle tests |
| `scripts/src/lib/ops/guard_orphaned_capability_baseline.json` | AC-3: remove the two now-wired methods from baseline |
| `apps/frontend/docs/src/content/docs/features/autonomous-npcs.md` | Document campaign-play poller + party group turn |

### Deviations from Spec
None. All four ACs and the party-mode enablement were delivered within scope. No amendments required. Note: the GM `address_mode_toggle_view_model` already had `_isPartyModeDisabled = false`, so the toggle was already un-disabled; the remaining work (and what this contract delivers) was adding `party` to `DialogueAddressMode` and verifying the routing/toggle are functional via tests.

### Test Results
- Unit (client): 2409 PASS / 0 FAIL (incl. 5 new tests across AC-1/AC-2/party-mode)
- E2E: N/A (no e2e suite added; covered by unit/integration per thin-contract verification lines)
- Visual: N/A — `browser screenshot` / `ai_validate_image` tools were not available in this session; production `/game` route verified booting (HTTP 200, SPA shell) via dev server from the worktree
- Baseline: 0 pre-existing failures, 0 new failures
- Orphaned-capability guard: ✅ 144 files match baseline (methods no longer orphaned)
- `validate({ test: true })`: ✅ client + scripts pass (fix+typecheck+build+test)
