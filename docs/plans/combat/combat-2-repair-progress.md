# Combat 2.0 repair — progress record (review F1–F11)

> **Read this file on resume.** It records the repair of the 16 September 2026
> combat review against `main` at `617f22a01dc80fdf9303ed466f9ab5aa860a2ccb`
> (repair base: `cc8043f10`). It is a **working record**, not an acceptance
> certificate: a finding is only "fixed" when the reproduction and the named
> regression test both exist on the branch, and only "verified" when the gate
> actually ran. Never describe partial work as complete.

Authority: `docs/architecture/combat_2.md`; the Combat-01..08 contracts
(`C-509`, `C-514`, `C-515`, `C-516`, `C-525`, `C-526`, `C-531`, `C-532`); the
review (`tmp/aikami-combat-review.md`) and execution prompt
(`tmp/aikami-combat-repair-prompt.md`).

## 0. Baseline identity

| Field | Value |
|---|---|
| Repository | `BearlySleeping/aikami` |
| Root checkout | `/home/sonny/Development/Projects/passion/aikami` (`main`) |
| Task worktree | `~/.herdr/worktrees/aikami/combat-2-repair` |
| Task branch | `fix/combat-2-repair` |
| Repair base | `main` @ `cc8043f10` (review baseline `617f22a01` is an ancestor) |
| Engine moon project id | `frontend-engine` (despite `project.name: engine`) |

### 0.1 Change log (reviewable slices)

| Commit | Slice | Findings |
|---|---|---|
| `ad8304a3d` | Preview/commit identity, intent commit exhaustiveness, truthful abilities, terminal ordering | F1 (partial), F3, F5, F6, F9 (ordering/labels) |
| `aaef296ce` | Direct-companion control ownership | F4 |
| `db07cac69` | Ordinary-command admission against a confirmed revision | F2 |
| `b6ec51c4a` | Hidden objectives + non-participants out of AI perception | F10 |
| `952841dff` | v2 FLEE through settlement as an escape | F9 (FLEE) |
| `da1c734ad` | Real companion in the production proof encounter | F11 |
| `f9d612936` | Live combat checkpoint save/restore | F7 (partial) |
| `03c4db781` | Repair finding table + verification record | docs |
| `4cafc7dd1` | Party escape as a pure kernel settlement, legal on any turn (E2E-driven) | F9 (FLEE) |

## 1. Finding → reproduction → fix → test → status

Legend: **Fixed** = source change + regression test on the branch. **Partial** =
a real, tested subset; the remainder is named. **Open** = not yet addressed.

| # | Review finding | Fix (files) | Regression test | Status |
|---|---|---|---|---|
| **F1** | Preview rebuilds state and drops round/turn/RNG/morale/reaction/settlement; `buildV2CombatState` rewrites positions from ECS | `combat_v2_resolver.ts` — the live state is returned **unchanged**; no ECS→kernel position path after start. `combat_preview_handler.ts` — the preview carries the committed environment/objectives/run identity | `combat_v2_resolver.test.ts` "returns the live kernel state unchanged — ECS is not a second position authority" | **Partial** — the ECS-position overwrite is removed and tested. The **single snapshot/read API** consolidation (one `buildCombatProjectionState` used by preview/compiler/AI/inspector/save) is **open**: `combat_preview_handler.buildCombatProjectionState` and `combat_v2_resolver.buildV2CombatState` still exist as two functions that must agree. |
| **F2** | Ordinary move/action/interact/end-turn commands lose acting identity and preview revision at the boundary | `combat_bridge_types.ts` (`CombatCommandAdmission`), `types.ts`, `combat_v2_resolver.ts` (`V2ResolvableCommand.basedOnRevision`), `combat_command_dispatch.ts`, client senders (`combat_selection_controller`, `combat_intent_flow`, `combat_object_inspector`, `combat_view_model`) | `combat_v2_resolver.test.ts` "refuses a delayed ordinary command bound to a superseded revision" + "accepts an ordinary command bound to the current revision" | **Partial** — revision admission is enforced and tested for every ordinary v2 variant. **Open**: the full serializable envelope (command id, encounter/run id, turn identity, duplicate-ID journal for restore/reaction continuation) and idempotent replay of an identical command id. |
| **F3** | `CombatIntentFlow._commit` has no `interactWithObject` branch, silently returns in its default, truncates ability targets, yet `confirm()` marks the plan committed | `combat_intent_flow.svelte.ts` — exhaustive switch returning a boolean; `interactWithObject` dispatches; the complete `targetIds` travel; unsupported variants produce a typed refusal. `combat_narration.ts` — `surrender` attempt template | `combat_intent_flow.test.ts` "an unsupported command variant is refused, never marked committed", "an object interaction is committed, not silently dropped", "a multi-target plan keeps its complete target set" | **Fixed** |
| **F4** | Direct-companion turns are handed to the client by the AI runner but the dispatcher/ViewModel gate on `active.entityId === playerEntityId` | `combat_command_dispatch.ts` — ownership via `isPlayerControlled`; `combat_view_model.svelte.ts` + `combat_bridge_types.ts`/`types.ts` — `TURN_CHANGED` carries `activeCombatantId`/`combatantIdsByEntity`; `combat_sync_events.ts` publishes them | `combat_ai_companion_ownership.test.ts` "accepts the Direct companion's own commands through the dispatcher" + "still rejects an AI companion turn the client does not own" | **Fixed** — also fixed a cross-suite `Companion` SoA leak that this exposed (teardown added). |
| **F5** | Utility class features spend cost for no effect; `opportunity_strike` granted to everyone and usable as an ordinary action/AI candidate; basic melee accepts multiple targets for one cost | `combat_state.ts` (`activation`/`supported`/`maxTargets`), `combat_kernel_validation.ts` (reaction-only refusal, `supported: false` → `unsupportedInV2` before spend, authored cardinality), `combat_abilities.ts` (honest support + reaction activation + `maxTargets`), `combat_v2_ai.ts` (reaction/unsupported abilities never chosen) | `combat_ability_support.test.ts` (3 cases); `combat_abilities.test.ts` (2 cases) | **Partial** — support/cardinality/activation are truthful and enforced. **Open**: implementing actual heal/resource effects, a level/entitlement model for grants, and sharing the reaction-attack resolution with the ordinary attack path (the reaction still resolves through its own isolated block in the kernel). |
| **F6** | `createEncounterRunId` derives identity from encounter id + seed, so a deterministic retry reuses the engine run id | `combat_run_identity.ts` (new; process- and world-nonced, per-encounter sequence), wired into `combat_state_adapter.ts`, `combat_v2_resolver.ts`, `combat_preview_handler.ts`, `combat_encounter_retry.ts` | `combat_run_identity.test.ts` (5 cases); `combat_v2_retry.test.ts` asserts a new run id + settlement id and gameplay equivalence | **Fixed** |
| **F7** | Save captures player ECS + services + world-objects but not the live kernel state; retry record omits depth/control metadata; no production caller of `migrateCombatStateToCurrentVersion`/`replayCombat` | `combat_bridge_types.ts` (`COMBAT_CHECKPOINT_REQUESTED`/`READY`/`RESTORED`), `combat_command_dispatch.ts` (restore resets the apply guard and installs the state), `game_save_envelope.ts` (`SaveCombatCheckpoint`, envelope **v6**, version-aware checksum), `game_save_service.svelte.ts` (capture + restore + unknown-rules-version refusal) | `game_save_service.test.ts` "a live v2 fight round-trips through the envelope and restores" + "an unknown combat rules version refuses the restore and preserves the slot" | **Partial** — an in-progress v2 fight now round-trips through a real libSQL database, and an unknown rules version is refused without deleting the slot. **Open**: the accepted-command journal (replay without AI), `replayCombat` production wiring, the reconstruct-from-checkpoint retry depth/control metadata, and transactional reward/consequence idempotency. |
| **F8** | `COMBAT_REACTION_OPENED` omits the committed revision; Auto/Never submit against the ViewModel's prior revision; a stale rejection clears the window instead of resyncing | `combat_bridge_types.ts` (`stateRevision`), `combat_v2_resolver.ts` (emits it), `combat_reaction_flow.svelte.ts` (prompt carries + submits `basedOnRevision`) | `combat_reaction_flow.test.ts` "the decision carries the window revision, not the live counter" | **Partial** — the read-vs-commit identity race is closed and tested. **Open**: engine-owned deterministic NPC reaction policy (no-UI), reload-during-window, queued multiple reactors, focus management/Escape, and the resync-on-stale-rejection surface. |
| **F9** | `COMBAT_ENDED` precedes the final `COMBAT_EVENTS_RESOLVED`; the bridge end event carries only victory; all non-player actors are labelled defeated; FLEE bypasses v2 settlement | `combat_v2_resolver.ts` — `combatEnded` mapping is a no-op; `emitCombatEnded` runs **after** the final facts batch and carries `settlement` + `participation(+ByEntity)`. `types.ts` + `combat_view_model.svelte.ts` — labels derive from participation, escape is not a defeat. `combat_command_dispatch.ts` — `_handleV2Flee` marks the party escaped and settles through v2 | `combat_v2_resolver.test.ts` "FLEE resolves through v2 settlement as an escape, not a defeat" | **Partial** — ordering, full settlement payload and participation-derived labels are fixed; v2 FLEE is a real escape with v2 cleanup. **Open**: run-scoped disposal of delayed overlay/music handoff timers, and external settlement reward recovery. |
| **F10** | `buildCombatDecisionContext` forwards hidden objective progress; `resolveEntitySelector` ranks all living combatants without participation/observation limits | `combat_ai_perception.ts` — hidden objectives filtered from the context; `combat_intent_compiler.ts` — non-participants excluded from selector grounding | `combat_intent_compiler.test.ts` (2 cases); `combat_ai_perception.test.ts` "a hidden authored objective never reaches the decision context" | **Partial** — hidden objectives and surrendered/escaped actors are excluded, tested. **Open**: a first-class observation/knowledge mask shared by compiler candidates, clarification, alternatives and fallback tactics (this slice uses participation + the existing visibility mask). |
| **F11** | `startRealEncounter` omits the companion binding; baseline proof/journey coverage incomplete | `game_test_seam.ts` — the proof seam resolves a recruited companion from the party roster and binds it | none yet (seam is E2E-only) | **Partial** — the seam now binds a real companion. **Open**: asserting the exact `player + village_guard vs ash_hound/cinder_thrall/ember_warden` roster, the inn/support distance fixture, running the ten C-532 AC-7 journeys, and the visual-suite cases. The E2E/visual lanes were **not** executed in this session. |

## 2. Save, retry, replay and rules-version behaviour (as implemented)

- **Envelope v6.** A v2 fight in progress writes a `combat` block
  (`SaveCombatCheckpoint`: `rulesVersion`, `state`, `encounterRunId`,
  `acceptedCommandCount`). The checksum is **version-aware**: v6 hashes the
  combat block, v5 the world block, v3/v4 the map block, v2 neither — so every
  older save still validates.
- **Restore.** `COMBAT_CHECKPOINT_RESTORED` resets the apply guard and the run
  identity, installs the stored state and re-syncs the driver. A `state: null`
  (or a pre-v6 save) clears any live state rather than resuming an uncaptured
  fight.
- **Unknown rules version.** A checkpoint whose `rulesVersion` differs from the
  current `COMBAT_RULES_VERSION` is **refused**: `loadGame` throws and the slot
  is left untouched. It is never executed under today's rules.
- **Retry.** Each attempt allocates a **new** run identity (F6) and resets the
  apply guard; gameplay is byte-equivalent once the run-scoped identities are
  normalized, which `combat_v2_retry.test.ts` asserts with a scoped normalizer.
- **Replay journal.** Not implemented: `replayCombat` still has no production
  caller and there is no accepted-command journal. This is the main open item
  under F7.

## 3. Verification actually run

Environment: worktree `~/.herdr/worktrees/aikami/combat-2-repair`, bootstrapped
with `bun run worktree:bootstrap`. Bun 1.4.0.

| Command | Result |
|---|---|
| `bun moon run schemas:typecheck types:typecheck utils:typecheck constants:typecheck frontend-engine:typecheck client:typecheck` | clean |
| `bun moon run utils:test` | 593 pass, 0 fail |
| `bun moon run constants:test` | 205 pass, 0 fail |
| `bun moon run frontend-engine:test` | 1498 pass, **3 fail** — the 3 pre-existing `game-data/` asset audits (verified identical with the changes stashed) |
| `bun moon run client:test` | 3646 pass, 7 skip, 2 todo, 0 fail |
| `bun run lint` | clean (the `local-stack:lint` Biome `run/`-dir diagnostics are pre-existing and not from this branch) |

### 3.1 Production `/game` E2E (executed)

Services: `bun run herdr:start client hub` (emulator mode, client `:5274`,
hub `:5276`), restarted after each source change so the dev server serves the
branch. Run with `--workers=1` — the game lane shares one emulator + dev server,
so parallel workers flake (see below).

| Lane | Command | Result |
|---|---|---|
| Combat-04 direct control | `bun run test --project=client combat_v2.spec.ts --workers=1` | **12 pass, 0 fail** (run twice) |
| C-532 encounter depth | `bun run test --project=client combat_v2_depth --workers=1` | **3 pass, 0 fail** |
| C-531 environment | `bun run test --project=client combat_v2_environment --workers=1` | 4 pass, **1 fail** — the pre-existing "out-of-range authored action reports why it is unavailable" (verified failing on the clean baseline; it is one of the review's two environmental fixture failures) |
| Combat-06 LLM-on | `bun run test --project=client-llm-on combat_v2_llm --workers=1` | **4 pass, 0 fail** (enabled-agents degrade, Suggest→edit→approve, mid-encounter mode change) |

**Parallel-worker flakiness (not a regression).** With the default worker count
the same `combat_v2.spec.ts` run fails a *different, rotating* subset of tests
(each timing out ~47 s in the COMBAT overlay) because the workers contend for one
emulator and one dev server. `--workers=1` is deterministic: 12/12, twice. The
AC-10 exit test was the first to surface this and is the one that drove the
party-escape kernel fix below.

**FLEE path fixed during E2E.** The first E2E run showed AC-10 never leaving the
COMBAT overlay on a retreat. Root cause: the escape was committed by replaying an
ordinary DEFEND command, which the kernel rejects when an AI actor (not the
player) is active. Committed `4cafc7dd1`: the party escape is now a pure kernel
entry (`resolvePartyEscape`) that marks the party escaped and runs the SAME
ordered resolution pass, so it is legal on any turn and publishes through the one
result path.

### 3.2 AI visual runner (executed)

`apps/e2e/src/visual/runner.ts`, full sweep then the combat suite alone. The
VLM is the `.env`-pinned `local_ollama` provider (`qwen3-vl:8b-thinking-q8_0`,
not pulled) with OpenRouter fallback.

**Full sweep** (`bun run src/visual/runner.ts --capture-only` → capture + eval):
**164 total, 104 passed, 60 failed.** The 60 failures are dominated by suites
unrelated to combat whose dev routes need seed assets/auth the worktree does not
have (e.g. `MapLoader: failed to fetch map "/emberwatch/maps/old_road.json"
(HTTP 404)`). They are environment-provisioning failures, not combat visual
defects.

**Combat suite verdicts (the relevant gate).** Every core combat case PASSED:

| Case | Verdict |
|---|---|
| Combat — Initial State | ✅ PASS |
| Combat — Log Filled | ✅ PASS |
| Combat — Low HP | ✅ PASS |
| Combat — Victory | ✅ PASS |
| Combat — Defeat | ✅ PASS |
| Combat — Production /game overlay | ✅ PASS |
| Combat — Production /game v2 tactical direct controls | ✅ PASS |
| Combat — Production /game v2 move highlights | ✅ PASS |
| Combat — Production /game v2 language intent preview | ✅ PASS |
| Combat — Production /game v2 AI intent + deterministic fallback | ✅ PASS |
| Combat — /game environment resolved (C-531) | ✅ PASS |
| combat-actions (HUD / theme / release-gate) | ✅ PASS |

Two combat-suite cases FAILED for **harness reasons, not visual defects**:

1. `Combat — Production /game companion control modes` — `ReferenceError:
   V2_RESOLVABLE_ENCOUNTER is not defined` from a `page.evaluate` callback that
   referenced a Node-scope constant without passing it as an argument. A
   pre-existing suite bug (the case had never actually run). **Fixed on this
   branch** (constant now passed into `page.evaluate`); the case re-runs in the
   targeted combat suite.
2. `Combat — /game environment preview (C-531)` — "the brazier preview never
   became visible". The same environmental fixture behaviour as the E2E failure
   in §3.1; the sibling `environment-resolved` case retries and PASSES, so the
   committed path works — only the pre-commit preview capture is flaky. Left
   open and recorded honestly.

**Still unmet:** the C-532 AC-7 ten-journey acceptance set as a documented
matrix, and a clean full-sweep visual verdict (the 60 unrelated failures need a
fully provisioned asset/auth environment).

Do **not** read the green unit lanes as production proof: `frontend-engine`'s
moon `test` task is `runInCI: false`, and the 3 asset failures above are the
provisioned-fixture lane, not a combat regression.

## 4. Outstanding gates and honest rollout

**Still open, in priority order:**

1. F1 single snapshot/read API; F2 full command envelope + duplicate-ID journal.
2. F5 effect implementation (heal/resource), level entitlement, shared
   reaction/ordinary attack resolution.
3. F7 accepted-command journal + replay wiring + retry depth/control metadata +
   idempotent external settlement/rewards.
4. F8 engine-owned NPC reaction policy and the window lifecycle edge cases.
5. F9 run-scoped delayed-timer disposal and external settlement recovery.
6. F10 shared observation/knowledge mask.
7. F11 the exact proof roster assertion, the inn/support distance fixture, the
   ten AC-7 journeys, and the visual-suite cases.

**Rollout recommendation: NOT READY.** The repair removes several high-severity
authority bugs and locks each with a regression test, but the F11 production
proof (the actual release gate) has not been executed, and the F1/F2/F5/F7
remainders are the same class of "incomplete translation between layers" the
review identified. Keep v2 and LLM production defaults unchanged and legacy
selectable; do not delete legacy behaviour on the strength of these unit lanes.
