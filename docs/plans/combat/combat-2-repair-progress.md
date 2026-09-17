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
| `d9f71e019` | E2E visual setup hook receives the encounter id | F11 |
| `6f7930d4b` | Executed E2E + visual results recorded | docs |

### 0.2 Second repair pass (review-repair brief, same branch)

The first pass left four findings with named remainders and, more importantly,
**three production-seam defects that its own tests could not see** because they
drove `dispatchCombatCommand` directly instead of the main-thread forwarder.
The second pass repairs those, then the remainders they gated.

| Slice | What it changes |
|---|---|
| Apply guard (F-A) | `applyCombatResult` returns a typed `accepted \| duplicate \| rejected`; installing/restoring authoritative state seeds the guard with the installed revision; a rejection publishes nothing |
| One command envelope (F-B) | Mandatory identity (`commandId`, encounter, run, turn, actor, revision) on every ordinary v2 command, with command-ID idempotency and an accepted-command journal |
| Forwarder seam | The main-thread forwarder now carries the whole command and registers the three commands it silently dropped |
| One save boundary (F-B/F7) | An atomic engine checkpoint plus a `sessionRevision` read barrier replaces three independent reads |
| Load preflight (F-B/F7) | `parse → validate → compatibility → migrate → plan → apply`; real schema validation and the canonical migration run before any runtime mutation |
| Confirmed command integrity (F3/F-D) | A confirmed movement path travels and is verified; `submitted` is distinguished from `committed` |
| Engine-owned reaction policy (F8) | `combat_v2_reaction_policy.ts` drains every window whose reactor the player does not control (or whose authored policy is `auto`/`never`) through the same kernel path; `runV2AiTurns` now suspends while a window is pending |
| Guard ceiling | Seven oversized modules extracted (resolver events/command mapping/reaction policy, kernel RNG/turn helpers, engine lifecycle events, client BGM + intent translations) instead of raising a baseline |

See §5 for the finding matrix and the exact regression tests.

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
| **F11** | `startRealEncounter` omits the companion binding; baseline proof/journey coverage incomplete | `game_test_seam.ts` — the proof seam resolves a recruited companion from the party roster and binds it; `combat.visual.ts` — the companion-controls setup hook now passes the encounter id (it threw `ReferenceError` before) | E2E `combat_v2.spec.ts` (12/12, `--workers=1`), `combat_v2_depth` (3/3), `combat_v2_llm` (4/4); visual combat suite (see §3.2) | **Partial** — the seam binds a real companion, the combat E2E lanes now run and pass, and the deterministic visual-suite harness bug is fixed. **Open**: asserting the exact `player + village_guard vs ash_hound/cinder_thrall/ember_warden` roster, the inn/support distance fixture (one environmental case still fails on baseline), the ten C-532 AC-7 journeys as a matrix, and a stable visual verdict (needs a quality VLM + provisioned assets). |

## 2. Save, retry, replay and rules-version behaviour

> **Superseded by §5.4.** This section records the FIRST pass's behaviour so the
> change history stays readable. The `acceptedCommandCount` placeholder it
> mentions was replaced by a real accepted-command journal; the three separate
> reads were replaced by one atomic checkpoint plus a read barrier; and the load
> order was replaced by `parse → validate → compatibility → migrate → plan →
> apply`. Read §5.4 for what the branch does now.

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
- **Replay journal.** Not implemented in the first pass: `replayCombat` had no
  production caller and there was no accepted-command journal.

## 3. Verification actually run

Environment: worktree `~/.herdr/worktrees/aikami/combat-2-repair`, bootstrapped
with `bun run worktree:bootstrap`. Bun 1.4.0.

### 3.0 🔴 `moon run` silently skips the engine suite when `CI=true`

`packages/frontend/engine/moon.yml` sets `options.runInCI: false` on `test`,
and moon's `run` action then reports **"No tasks found"** for
`frontend-engine:test` whenever `CI` is set in the environment — which it is in
this shell and in GitHub Actions. The suite must be invoked as:

```sh
CI= bun moon run frontend-engine:test
```

A generic green `moon ci` run is therefore **not** evidence that the
deterministic engine combat tests executed. Every engine number below was
produced with `CI=` unset.

### 3.1 First pass (committed on the branch before this pass)

| Command | Result |
|---|---|
| `bun moon run schemas:typecheck types:typecheck utils:typecheck constants:typecheck frontend-engine:typecheck client:typecheck` | clean |
| `bun moon run utils:test` | 593 pass, 0 fail |
| `bun moon run constants:test` | 205 pass, 0 fail |
| `CI= bun moon run frontend-engine:test` | 1498 pass, 3 fail — the `game-data/` asset audits |
| `bun moon run client:test` | 3646 pass, 7 skip, 2 todo, 0 fail |
| `bun run lint` | clean |

### 3.2 Second pass (this repair) — executed

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | 1461 installs, no changes |
| `bun moon run schemas:typecheck types:typecheck utils:typecheck constants:typecheck frontend-engine:typecheck client:typecheck` | **clean** (7 tasks) |
| `bun moon run e2e:typecheck` | clean |
| `bun moon run schemas:test` | **881 pass, 0 fail** |
| `bun moon run constants:test` | **205 pass, 0 fail** |
| `bun moon run utils:test` | **596 pass, 0 fail** |
| `bun moon run client:test-unit` | **3685 pass, 0 fail** (3688 ran, 280 files) |
| `CI= bun moon run frontend-engine:test` | **1591 pass, 1 fail** (1592 ran, 99 files) — the pre-existing `Emberwatch content audit > pack version bumped to the fixture version` (content pack reports `4.4.0`; unrelated to combat and not touched by this branch) |
| `bun run lint` | **clean** (40 tasks) |
| `bun run guard` | **clean** — all 10 guards; source-file-size 3534 files / 35 baselined / 173 warnings; type-safety `T1=11 T2=4 T3=1` |

New regression suites added by this pass:

| Suite | Cases | Failure classes covered |
|---|---|---|
| `packages/frontend/engine/src/__tests__/combat_apply_guard.test.ts` | 7 | 1, 2, isolated worlds |
| `packages/frontend/engine/src/__tests__/combat_command_envelope.test.ts` | 13 | 6, 7, 8, 19 |
| `packages/frontend/engine/src/__tests__/combat_command_forwarder.test.ts` | 11 | the production seam (F2/F3/F7/F4 reachability) |
| `packages/frontend/engine/src/__tests__/combat_session_checkpoint.test.ts` | 16 | 21, 22 |
| `packages/frontend/engine/src/__tests__/combat_v2_path_identity.test.ts` | 4 | 3, 4 |
| `apps/frontend/client/src/lib/services/game/game_save_combat_preflight.test.ts` | 12 | 17 |
| `game_save_service.test.ts` (2 added) | 2 | 17 (no partial mutation, real schema validation) |
| `combat_intent_flow.test.ts` (3 updated) | 3 | 10 (`submitted` ≠ `committed`) |
| `combat_settlement_ledger.test.ts` | 11 | 20 (settlement identity), 23 (run guard) |
| `bridge_listeners.test.ts` (+8) | 8 | 20, 23 (exactly-once consequences, stale close) |
| `packages/frontend/engine/src/__tests__/combat_sync_events.test.ts` | 2 | 20 (run identity on the live-snapshot re-emission) |

### 3.3 CI

The GitHub Actions failure on PR #369 was
`scripts:guard-source-file-size — 4 oversized, 0 config issue(s)`:

```
❌ apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts — 2507 lines, limit 2500 (+7)
❌ packages/frontend/engine/src/combat/combat_v2_resolver.ts — 888 lines, limit 800 (new oversized, +88)
❌ packages/frontend/engine/src/types.ts — 1001 lines, limit 957 (+44)
❌ packages/shared/utils/src/lib/rules/combat_kernel.ts — 1268 lines, limit 1184 (+84)
```

Reproduced locally and fixed by **extracting cohesive modules** — no baseline
was raised:

| File | Now | Extraction |
|---|---|---|
| `combat_v2_resolver.ts` | 770 | `combat_v2_events.ts` (kernel-event → bridge-event projection, reaction surface) |
| `types.ts` | 936 | `combat/combat_v2_lifecycle_events.ts` (`TURN_CHANGED` / `COMBAT_STARTED`) |
| `combat_kernel.ts` | 1124 | `combat_kernel_rng.ts`, `combat_kernel_turns.ts`, `combat_rules_version.ts` |
| `combat_view_model.svelte.ts` | 2491 | `combat_bgm.ts`, `combat_intent_translations.ts` |

`combat_bridge_types.ts` (which the extraction pushed to 809) is back at 763 by
moving its session-checkpoint command/event contract into
`combat_session_checkpoint.ts`.

### 3.4 Not run in this pass

| Gate | Why |
|---|---|
| Production `/game` E2E (`combat_v2.spec.ts` and friends) | Requires the emulator + dev server + provisioned assets. **Not re-executed since the first pass** — and the third pass DOES add production routes (the settlement ledger, the run identity on the wire, the live-snapshot re-emission), so the first-pass E2E results are stale evidence for those paths. Treat the E2E rows in §3.5 as first-pass evidence only. |
| AI visual runner | Not re-executed; the first pass recorded it as an **unstable** gate. |
| `client:test-browser` | Not executed (browser lane). |

### 3.5 First-pass E2E / visual evidence (unchanged, still the only E2E evidence)

#### Production `/game` E2E (executed in the first pass)

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

#### AI visual runner (executed in the first pass)

`apps/e2e/src/visual/runner.ts`, full sweep then the combat suite alone. The
VLM is the `.env`-pinned `local_ollama` provider (`qwen3-vl:8b-thinking-q8_0`,
not pulled) with OpenRouter fallback.

**Full sweep** (`bun run src/visual/runner.ts --capture-only` → capture + eval):
**164 total, 104 passed, 60 failed.** The 60 failures are dominated by suites
unrelated to combat whose dev routes need seed assets/auth the worktree does not
have (e.g. `MapLoader: failed to fetch map "/emberwatch/maps/old_road.json"
(HTTP 404)`). They are environment-provisioning failures, not combat visual
defects.

The AI visual lane is **not a reliable gate in this environment** and its verdict
is recorded here honestly rather than as a pass. Two executions of
`--suite=combat` on the same commit produced **inconsistent verdicts**:

| Run | Result |
|---|---|
| Full warm sweep (`–capture-only`) | every core combat case PASS |
| Targeted run #1 (cold client) | 6 pass / 7 fail — the `/game` cases scored 60/25/0/75 |
| Targeted run #2 (warm client) | **9 pass / 4 fail** — the same `/game` cases now score 90–100 |

The VLM itself is inconsistent: on targeted run #2 it returned `PASS` for cases
while listing contradicting issues (e.g. "Combat — Low HP" passed with the issue
"Player HP bar is not critically low … it is at full health"). That is a
provider-quality limit (`.env` pins `VLM_PROVIDER=local_ollama` with model
`qwen3-vl:8b-thinking-q8_0`, which is **not pulled**; evaluation therefore ran
through the OpenRouter fallback), not a combat signal.

**What the visual lane did prove:**

- The `/game` production-overlay, v2 tactical, v2 move-highlight, v2 language
  preview, v2 AI fallback, companion-control, environment-preview and
  environment-resolved cases all captured and evaluated the real production
  route; their screenshots rendered a live fight with the sidebar, turn tracker
  and actions.
- `Combat — /game environment preview` and `… environment resolved` both PASSED
  on the warm run — the committed environmental path works end-to-end.
- The one **deterministic** visual-suite defect was a harness bug, now fixed:
  `Combat — Production /game companion control modes` threw `ReferenceError:
  V2_RESOLVABLE_ENCOUNTER is not defined` because a `page.evaluate` callback
  referenced a Node-scope constant without passing it as an argument. It now
  evaluates at **100/100**. Contract: this makes the case runnable for the first
  time.

**Defect this run surfaced (fixed):** the party FLEE exit (see §3.1) — the AC-10
E2E test never left the COMBAT overlay on a retreat.

**Still unmet:** the C-532 AC-7 ten-journey acceptance set as a documented
matrix; a *stable* visual verdict (needs a pulled/quality VLM and a fully
provisioned asset/auth environment so the 60 unrelated suites stop 404-ing). Do
not treat the visual lane as green yet.

Do **not** read the green unit lanes as production proof: `frontend-engine`'s
moon `test` task is `runInCI: false`, and the 3 asset failures above are the
provisioned-fixture lane, not a combat regression.

## 4. Outstanding gates and honest rollout

**Still open after the second pass, in priority order:**

1. **F7 replay wiring.** The accepted-command journal is recorded, persisted and
   restored, and it backs command-ID idempotency — but `replayCombat` still has
   no production caller, there is no replay UI, and **the journal is not yet
   complete enough to replay from**. `COMBAT_REACTION_SELECTED` returns early at
   `combat_v2_resolver.ts:485` straight into `commitV2KernelCommand` and is never
   recorded, and the engine-driven commit sites (`combat_ai_decision.ts`
   356/404/604, `combat_ai_turns.ts:255`, `combat_v2_ai.ts:412/452`) bypass
   `recordCommandOutcome` too. Recording every accepted state-changing command
   (reaction decisions + engine/AI commits) is the PREREQUISITE for wiring a
   caller: a replay built on today's journal would silently diverge. The
   production caller must then enforce the supported-rules policy and report the
   first divergence (journal index/command id, expected vs actual revision,
   expected vs actual event/result, first differing field).
2. **F7 external settlement recovery — implemented, E2E gap.** The durable
   settlement-identity ledger and the run-scoped presentation guard are in place
   and tested (see §5.5); what remains is the production `/game` re-run that
   would move it from Partial to Fixed.
3. **F8 window lifecycle.** Reload-during-window resync, queued reactors through
   the client surface, focus/Escape, optional timeout-to-decline, and the
   stale-rejection resync path. The *policy* is engine-owned now; the *surface*
   lifecycle is not.
4. **F5 effect implementation.** Heal/resource effects, a level/entitlement
   model for ability grants, and a shared reaction/ordinary attack resolution
   path.
5. **F9 run-scoped timer disposal — implemented, E2E gap.** Delayed
   presentation/reaction timers are bound to the encounter run
   (`combat_run_scoped_timer.ts`, `combat_presentation_timers.ts`); the
   production `/game` re-run is what remains.
6. **F10 observation/knowledge mask.** A first-class mask shared by compiler
   candidates, clarification, alternatives, fallback tactics, telegraphs and
   object grounding.
7. **F11 production proof.** The exact proof-roster assertion, the inn/support
   distance fixture, the ten C-532 AC-7 journeys as a matrix, and a stable
   visual verdict.
8. **F1 projection consolidation.** `buildCombatProjectionState` and
   `buildV2CombatState` still exist as two functions that must agree.
9. **F4 production-control journey.** The Direct-companion journey is asserted
   at the dispatcher/forwarder level, not through the real client controls.

**Rollout recommendation: NOT READY — but materially closer than at review.**
The repair removes several high-severity authority bugs, locks each with a
regression test, and the production `/game` E2E lanes now run and pass
(Combat-04 12/12, depth 3/3, LLM-on 4/4; one environmental case fails on the
clean baseline too). The visual combat suite renders and evaluates the real
production route, and the one deterministic harness defect it exposed is fixed.

What still blocks a release:

- the C-532 AC-7 ten-journey acceptance matrix has not been produced;
- the visual lane is not a stable gate in this environment (inconsistent VLM,
  requires a pulled model and provisioned assets);
- the production `/game` E2E lanes were **not re-executed** in the second pass,
  so the E2E evidence is first-pass evidence for a branch that has since
  changed;
- the F1/F5/F7/F8/F9/F10/F11 remainders above are the same "incomplete
  translation between layers" the review named.

**What the second pass did change about the rollout picture:** the
command-admission boundary, the publication gate and the save/restore preflight
are now genuinely enforced *at the production seam* (forwarder + worker), with
regression tests that assert the forwarded envelope and the refusal paths rather
than a helper call. That removes the "tests pass, production does not" class of
defect from F2/F3/F7, which is the most valuable thing this pass accomplished.

Keep v2 and LLM production defaults unchanged and legacy selectable; do not
delete legacy behaviour on the strength of these lanes.

## 5. Second repair pass — finding matrix

Legend unchanged: **Fixed** = source change + regression test on the branch.
**Partial** = a real, tested subset with the remainder named. **Blocked** = a
gate that could not be executed here, with the reason.

### 5.1 The three production-seam defects this pass found

The first pass's F2/F3/F7 fixes were proven by tests that called
`dispatchCombatCommand` directly. That bypasses `EngineBridge.send` on the main
thread, which drops a command whose type has no registered forwarder and posts
only the fields the forwarder copies. Three defects lived exactly there:

1. **The forwarder dropped the admission fields.** `basedOnRevision` was
   dropped for `COMBAT_MOVE`, `COMBAT_END_TURN` and `COMBAT_INTERACT`; the whole
   identity block did not exist; and `targetIds` was dropped for
   `COMBAT_ACTION`, so the multi-target fix never reached the kernel in
   production. The F2/F3 fixes were therefore **not in effect at the seam**.
2. **`COMBAT_CHECKPOINT_REQUESTED` and `COMBAT_CHECKPOINT_RESTORED` had no
   forwarder at all.** In production the mid-combat save request timed out (and
   the save was skipped) and a loaded checkpoint was never installed. The F7
   round-trip test passed only because it registered its own handler on a
   `MockEngineBridge`.
3. **`COMBAT_COMPANION_MODE_SET` had no forwarder either**, so switching a
   companion to `direct` never reached the engine in production — the F4 fix
   worked in tests and not in the game.

All three are now registered and covered by
`packages/frontend/engine/src/__tests__/combat_command_forwarder.test.ts`, which
asserts the **forwarded envelope** rather than the registrar body.

### 5.2 Finding status after the second pass

| # | Status | Implementation | Regression test |
|---|---|---|---|
| **F1** | **Partial** | ECS is not a second position authority; the live kernel state is returned unchanged; the save boundary now reads ONE atomic projection. The two remaining projection functions (`buildCombatProjectionState`, `buildV2CombatState`) are still separate, but the save/checkpoint path no longer mixes them. | `combat_v2_resolver.test.ts` "returns the live kernel state unchanged"; `combat_v2_path_identity.test.ts` "repeated previews leave state, RNG and the accepted boundary untouched" |
| **F2** | **Fixed** | One `CombatCommandIdentity` envelope (`combat_command_envelope.ts`) verified before the kernel for every ordinary variant; command-ID idempotency; a persisted accepted-command journal; the forwarder carries it verbatim. | `combat_command_envelope.test.ts` (13 cases: missing identity, run mismatch, stale turn, actor mismatch, duplicate no-reroll, duplicate-of-failure, ID/content conflict, cross-run rejection, journal replay input, bounded journal); `combat_command_forwarder.test.ts` (11 cases) |
| **F3** | **Fixed** | `_commit` is exhaustive and returns the minted `commandId`; the complete target set travels; `interactWithObject` dispatches; the confirmed movement path travels and the engine refuses a materially different reconstruction. | `combat_intent_flow.test.ts` (unsupported variant, object interaction, complete target set, `submitted` → `committed` on the correlated ack, rejection surfaced); `combat_v2_path_identity.test.ts` (3 path cases) |
| **F4** | **Partial** | Ownership is the engine's policy, not `playerEntityId`; `COMBAT_COMPANION_MODE_SET` is now forwardable; the object inspector asks on behalf of the ACTIVE combatant. The full production-control journey (move/attack/interact/end-turn for a Direct companion through the real client) is **not** asserted end-to-end here. | `combat_ai_companion_ownership.test.ts`; `combat_command_forwarder.test.ts` "forwards COMBAT_COMPANION_MODE_SET" |
| **F5** | **Partial** | Support/activation/cardinality remain truthful and enforced (first pass). Real heal/resource effects, a level/entitlement model and shared reaction/ordinary attack resolution remain **open**. | `combat_ability_support.test.ts`, `combat_abilities.test.ts` |
| **F6** | **Fixed** | Execution identity is allocated outside the kernel and now persisted/restored with the checkpoint; a retry allocates a new one; the envelope binds commands to it. | `combat_run_identity.test.ts`; `combat_v2_retry.test.ts`; `combat_command_envelope.test.ts` "rejects a delayed command from a previous run at the same revision" |
| **F7** | **Partial** | One atomic checkpoint (state, journal, initial retry checkpoint with authored actor bindings, pending reaction, settlement, world objects) plus a `sessionRevision` read barrier; the client captures the ECS snapshot between two readings and retries until they agree; the load path is `parse → validate → compatibility → migrate → plan → apply`; external settlement consequences are now **exactly once** (§5.5). **Open**: `replayCombat` still has no production caller, and the journal is not yet complete enough to replay from — reaction decisions and engine/AI commits bypass `recordCommandOutcome`; retry depth/control metadata is persisted but the retry-time *reaction budget* continuation across a reload is not separately asserted. | `combat_session_checkpoint.test.ts` (16 cases); `game_save_combat_preflight.test.ts` (12 cases); `game_save_service.test.ts` "a corrupt combat checkpoint fails the load WITHOUT touching the running game" + "the load validates the nested combat checkpoint with real schemas"; `combat_settlement_ledger.test.ts` (11) + `bridge_listeners.test.ts` (+8) |
| **F8** | **Partial** | `COMBAT_REACTION_OPENED` carries the committed revision, and the engine now OWNS the deterministic policy: `resolveEngineReactionPolicies` drains every window whose reactor the player does not control (or whose authored policy is `auto`/`never`) through the same kernel command path — no model call, no UI, no timer. `runV2AiTurns` suspends while a window is pending, so an AI turn can no longer spin against `reactionPending` or force an `endTurn` through a suspension. Still **open**: reload-during-window resync, queued multiple reactors through the client surface, focus/Escape, optional timeout-to-decline, and the stale-rejection resync path. | `combat_reaction_flow.test.ts`; `combat_reaction_bridge.test.ts` ("resolves a non-player-controlled reaction with NO mounted decision surface", "suspends for a player-controlled reactor and resolves its decline exactly once", "accepts the opportunity attack and consumes the reaction") |
| **F9** | **Partial** | `COMBAT_ENDED` follows the final facts batch and carries the settlement + participation; FLEE is a real v2 escape; the accepted transition is projected **before** anything is published; delayed presentation/reaction timers are bound to the encounter run, and external settlement consequences are exactly once with a durable ledger (§5.5). Still **open**: the production `/game` re-run that would promote the settlement/timer work to Fixed. | `combat_v2_resolver.test.ts` "FLEE resolves through v2 settlement as an escape"; `combat_apply_guard.test.ts` "a rejected application publishes no mechanical success"; `combat_run_scoped_timer.test.ts`; `combat_settlement_ledger.test.ts`; `bridge_listeners.test.ts` |
| **F10** | **Partial** | Hidden objectives and surrendered/escaped actors are out of the AI decision context and the selector. Still **open**: a first-class observation/knowledge mask shared by compiler candidates, clarification, alternatives and fallback tactics. | `combat_ai_perception.test.ts`, `combat_intent_compiler.test.ts` |
| **F11** | **Partial** | The seam binds a real companion; the combat E2E lanes run and pass. Still **open**: the exact proof-roster assertion, the inn/support distance fixture, the ten AC-7 journeys, a stable visual verdict. | E2E lanes (§3.1) |

### 5.3 New invariant now enforced

> There is exactly one authoritative combat state for a v2 encounter, every
> mechanical command is admitted against explicit identity and revision, and no
> consumer observes a successful transition until that transition has been
> accepted and coherently projected.

Enforced by three gates:

1. `applyCombatResult` returns a typed outcome; `commitV2ResolvedResult` returns
   a typed rejection on `rejected` and publishes nothing. A `duplicate` is a
   no-op that re-acknowledges the original acceptance.
2. `admitV2Command` runs before the kernel for every ordinary variant and
   refuses on missing identity, encounter mismatch, run mismatch, stale
   revision, stale turn, actor mismatch, non-owned actor and ID/content
   conflict — spending no budget, no RNG and emitting no event.
3. The forwarder copies the whole command, so the worker sees what the client
   sent.

### 5.4 Persistence, retry, replay, run identity (as now implemented)

- **Save boundary.** `COMBAT_SESSION_CHECKPOINT_REQUESTED` captures every
  combat-related durable fact in ONE worker turn and reports the
  `sessionRevision` it belongs to. The client then takes the ECS snapshot and
  re-reads the boundary; the save is written only when the two readings agree
  (up to 4 attempts). A save that cannot be captured coherently is **skipped**
  rather than written wrong.
- **Checkpoint contents.** `schemaVersion`, `rulesVersion`, `encounterId`,
  `encounterRunId`, `stateRevision`, `sessionRevision`, the authoritative
  `state`, the accepted-command `journal`, the initial `initialCheckpoint`
  (participants, authored `npcId`/`classIds`, opening cells/stats, opening
  environment, pinned depth, per-combatant control mode — with **no raw eids**),
  the pending reaction window, the settlement, stable `actorBindings` and the
  committed `worldObjects` block.
- **Restore.** `parse → checksum validate → preflight (schema validate +
  compatibility + `migrateCombatStateToCurrentVersion`) → plan → apply`. A
  refusal throws before `restoreSnapshot`, `WORLD_OBJECTS_RESTORED`,
  `COMBAT_CHECKPOINT_RESTORED` or `hydrateAllServices` runs, so the running game
  and the stored save are both untouched.
- **Rules-version policy.** `SUPPORTED_COMBAT_RULES_VERSIONS` (in the leaf
  `combat_rules_version.ts`) contains only the current version. A historical
  version is refused with `unsupportedRulesVersion` rather than executed under
  today's kernel.
- **Retry.** A retry allocates a **new** run identity and restores the recorded
  initial checkpoint (including control metadata and pinned depth); gameplay is
  byte-equivalent once run-scoped identities are normalized.
- **Replay.** The accepted-command journal is real, ordered and persisted
  (`acceptedCommandsForReplay`). `replayCombat` still has **no production
  caller** — the journal is used for idempotency, not yet for a user-facing
  replay. It is also **not yet complete enough to replay from**:
  `COMBAT_REACTION_SELECTED` and the engine-driven (AI) commits bypass
  `recordCommandOutcome`, so a replay built on today's journal would diverge.
  This is the main open F7 item.
- **Run identity.** `combat_run_identity.ts` allocates outside the pure kernel
  with a process nonce + per-world nonce + per-encounter sequence. Every
  ordinary command binds to it, so an old run's command is refused even when the
  revision numbers coincide.
- **Settlement recovery.** Implemented in the third pass — see §5.5.

### 5.5 Third pass — external settlement consequences are exactly once (F7/F9)

`COMBAT_ENDED` consequences used to be applied unconditionally, and the delayed
close timer had no idea which encounter it belonged to.

| Piece | Implementation |
|---|---|
| Durable ledger | `combat_settlement_ledger.svelte.ts` — a persisted `appliedSettlementIds` (bounded, newest-first retention) plus an IN-MEMORY run guard. Registered as a serializable service, so the claim rides the **same save** as the consequences it guards. |
| Claim key | The kernel's `settlementId` (`settlementIdFor(encounter, run, revision, reason)`) — binds the EXECUTION RUN, never the encounter id (recurs on retry) and never the revision (recurs across runs). |
| Ordering | The claim is recorded **before** the consequence is emitted, and the whole block is synchronous, so the crash window between them is not observable to persistence: no lost and no doubled reward. |
| Run identity on the wire | `encounterRunId` is carried on `COMBAT_STARTED` (the driver **and** the live-snapshot re-emission, which fires on every combat mount) and on `COMBAT_ENDED`. Without it on the re-emission the client's guard silently degraded to the authored encounter id on every remount. |
| Regression tests | `combat_settlement_ledger.test.ts` (11); `bridge_listeners.test.ts` (+8: duplicate victory, retry re-earns, repeated presentation, claim-before-consequence, re-presented after reload, duplicate defeat, stale close A→B, the close firing for its own run); `combat_sync_events.test.ts` (2). |

**Status: Partial.** Production implementation and regression tests are in
place; the production `/game` re-run that would promote it to **Fixed** has not
been executed.
