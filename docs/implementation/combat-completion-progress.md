# Combat 2.0 completion — durable progress record

Authority: `tmp/aikami_combat_completion_prompt.md` (review + execution prompt),
governed by `docs/architecture/combat_2.md`.

Read this file on resume. Never restart or silently drop an unfinished criterion.
Never describe partial completion as contract completion.

## 0. Baseline identity

| Field | Value |
|---|---|
| Repository | `BearlySleeping/aikami` |
| Root checkout | `/home/sonny/Development/Projects/passion/aikami` (main @ `acb9c9a42`) |
| Task worktree | `/home/sonny/.herdr/worktrees/aikami/task-combat-2-completion` |
| Task branch | `task/combat-2-completion` |
| Base | `origin/main` @ `acb9c9a42` |
| Reviewed PR head | `d9b57231c5571af6e9a0e6d9d960a29e8b5fc6e1` (branch `contract-task-c-526-mu0hqeoq`) |
| PR #349 status | **merged** into main as `8d66f8e04` (implementation) + `acb9c9a42` (docs) |
| C-526 contract version on main | `3.0.1` (approved) — checked-in frontmatter says `status: implemented` |
| C-527 / C-528 | **absent** — reserved only by `combat_2.md` §22.3; to be drafted at the reserved IDs |
| Progress doc | `docs/contracts/PROGRESS.md` (C-526 currently `👍 approved`) |

### Delta: reviewed head → main

`git diff d9b57231c...acb9c9a42` shows the C-526 implementation files are
byte-identical for the decision service, controller, perception, narration
policy and roster. Main adds unrelated work (asset/generation jobs,
contract-pipeline cleanup) plus the C-526 contract amendment to `3.0.1` and
its docs commit. **Conclusion: every P1 finding in the review reproduces on
main as-is. Findings are treated as live, not historical.**

## 1. Acceptance-criterion map (C-526)

Status legend: ✅ implemented + evidenced · 🟡 partially implemented · ⬜ not started · ⛔ blocked

| AC | Requirement (abbrev.) | Implementation | Production consumer | Test | Status |
|---|---|---|---|---|---|
| AC-1 | Typed, bounded, selector-only decision contract | `schemas/.../combat_ai_decision.ts` | services + engine | `combat_ai_decision.test.ts` (schemas) | 🟡 review open |
| AC-2 | Perception snapshot contains only what the actor may perceive | `combat_ai_perception.ts#buildCombatDecisionContext` | `combat_ai_decision.ts`, `combat_ai_controller.svelte.ts` | `combat_ai_perception.test.ts` | ⛔ **P1: production is omniscient** |
| AC-3 | Service deadlines / cancellation / idempotency / telemetry | `combat_ai_service.svelte.ts` | controller | `combat_ai_service.test.ts` | ⛔ **P1: deadline + batch lifecycle** |
| AC-4 | Step-wise kernel execution with legal fallback | `combat_ai_decision.ts` | turn driver / worker | `combat_ai_decision.test.ts` (engine) | 🟡 review open |
| AC-5 | Prefetch, batching, never blocks a frame | `combat_ai_controller.svelte.ts`, turn driver | `/game` | controller + engine tests | ⛔ **P1: not squad-aware; identity/stale** |
| AC-6 | Companion control modes as persisted preference | schema only (`party.ts#controlMode`) | **none** | `party.test.ts` | ⛔ **P1: no runtime effect** |
| AC-7 | Readable intention + visible degradation | `emitCombatAiOutcome`, `createDegradedEmitter` | ViewModel | `combat_ai_events.test.ts` | 🟡 review open |
| AC-8 | Character over perfect optimization | `CombatDecisionPolicy` | **not supplied in production** | perception/prompt fixtures | 🟡 |
| AC-9 | Kill switch guarantees offline/deterministic | flag plumbed (`PUBLIC_COMBAT_LLM_AGENTS`) | encounter start | flag tests | 🟡 |
| AC-10 | Production journey exercises agents + narration E2E | partial | `/game` | `combat_v2.spec.ts` | ⛔ **P1: flag-off only** |
| AC-11 | Narration facts-only, bounded, degrades to templates | `combat_narration_service.svelte.ts` + `combat_narration_policy.ts` | ViewModel | narration service test | ⛔ **P1: substring lists ≠ facts-only** |

## 2. Confirmed review findings → reproduction, fix, verification

| # | Priority | Finding | Confirmed on main | Repro/regression test | Fix | Verified |
|---|---|---|---|---|---|---|
| F1 | P1 | Companion modes persisted but no runtime effect | ✅ `combat_roster.ts#controllerFor` L68 returns `companion_ai` for any recruited companion; no `controlMode` read anywhere in engine/UI | pending | pending | ☐ |
| F2 | P1 | Deadline cleanup can leave provider requests running | ✅ see §3 analysis | pending | pending | ☐ |
| F3 | P1 | Batch decisions bypass single-decision lifecycle | ✅ `decideBatch` mints `_batchControllers` keyed by decisionId but batch `_remember` races the single path; shared transport cancellation is undefined | pending | pending | ☐ |
| F4 | P1 | Async work survives encounter reset; cache keys lack run identity | ✅ `combat_ai_controller.svelte.ts` cache key `combatantId:stateRevision` (no encounter run), `currentState` reused on `encounterId + revision` only, no `COMBAT_ENDED` subscription, `inFlight` leaks on batch throw, late `submit` after `reset()` | pending | pending | ☐ |
| F5 | P1 | Production perception + personality not wired | ✅ `combat_ai_controller.svelte.ts#planActor`/`prefetch` call `buildCombatDecisionContext({state, combatantId})` with no `visibleCombatantIds` and no `policy` | pending | pending | ☐ |
| F6 | P1 | Prefetch is not squad-aware | ✅ `prefetch()` filters `combatantId !== playerCombatantId` and `.slice(0, 3)` → mixes companions and enemies into ONE provider call | pending | pending | ☐ |
| F7 | P1 | Narration validation cannot uphold facts-only | ✅ `combat_narration_policy.ts` — `VICTORY_TERMS` gated only on `facts.ended?.victory !== true`; any ended encounter permits victory terms; death terms resolve by clause heuristics; unlisted invented outcomes pass | pending | pending | ☐ |
| F8 | P1 | Production E2E evidence misses the enabled-agent failure path | ✅ `combat_v2.spec.ts` covers the flag-off lane only | pending | pending | ☐ |
| F9 | P2 | Docs/completion evidence disagree | ✅ contract frontmatter `status: implemented` while `PROGRESS.md` says `👍 approved`; Execution Report still `Pending` | n/a | pending | ☐ |

### §3 Analysis: F2 (deadline cleanup) — exact mechanism

`combat_ai_service.svelte.ts#_run`:

- `hardTimer` is created up-front, `cleanup()` clears it.
- On a soft timeout the code sets `preserveHardAbort = true` and defers
  `cleanup` onto `draftReply.settled`. That is *mostly* correct for the
  single-decision happy path.
- **Defect A — retry budget:** the loop runs up to `MAX_ATTEMPTS = 2`
  attempts, each awaiting `_requestDraft`, whose soft deadline is a *fresh*
  `softDeadlineMs` timer. Total wall time can therefore be `2 × 1500 ms`
  against a *single* 4000 ms hard deadline, and there is no check that the
  hard deadline has already elapsed between attempts. Contract: "Bound
  retries within the original deadline, not a fresh full deadline per
  attempt."
- **Defect B — `settled` never rejects/resolves if the provider ignores
  `AbortSignal`:** `draftReply.settled` resolves only from the provider
  promise's own `.then/.then(onRejected)` handlers. A provider that neither
  resolves nor rejects (a hung fetch with no abort support) leaves `settled`
  permanently pending; `cleanup` is then only reached via the hard timer.
  Correct, but only by accident, and only for the single path.
- **Defect C — batch:** `_runBatch` sets `preserveHardAbort` on soft timeout
  but the per-decision `_batchControllers` entries are only removed by the
  shared `cleanup`, which runs when the *whole batch* settles. A single
  member cancelled through `cancel(decisionId)` therefore cannot free its own
  transport slot without aborting every other member (the code aborts the
  shared controller only when it is no longer referenced — leaving the other
  members running against an aborted signal, which is an undefined contract).
- **Defect D — narration:** `combat_narration_service.svelte.ts` shares the
  same soft-timeout cleanup shape; needs the same discipline.
- **Defect E — telemetry:** `_failure` collapses `ABORTED` and provider
  rejection into `'offline'`/`'timeout'` at the `_run` call-site
  (`raw === PROVIDER_ERROR || raw === undefined ? 'offline' : 'timeout'`),
  losing the cancelled/aborted distinction the prompt requires.

## 4. Decisions, deviations, blockers

### Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Work on `task/combat-2-completion` in a herdr worktree from `origin/main` | Isolated, reviewable; root checkout untouched |
| D2 | Repair C-526 before drafting C-527/C-528 | The execution prompt gates C-527 on resolved lifecycle/authority defects |
| D3 | Findings are reproduced against current code, not assumed from the review | The review explicitly says "inspected behavior, not immutable assumptions" |

### Deviations

None yet.

### Blockers

None yet.

## 5. Commands run

| When | Command | Result |
|---|---|---|
| baseline | `herdr worktree create --branch task/combat-2-completion --base origin/main` | created `wGK` |
| baseline | `bun -e bootstrapWorktree(... install: true)` | ok |
| baseline | `bun moon run schemas:test constants:test frontend-engine:test client:test` | see §6 |

## 6. Baseline test results

Clean baseline before any edit (main @ `acb9c9a42` on the task branch):

| Command | Result |
|---|---|
| `bun moon run schemas:test constants:test frontend-engine:test client:test` | `client:test` 3212 pass / 0 fail; `schemas:test` 753 pass / 0 fail; **`frontend-engine:test` is not a valid moon target** — the project id is `engine`, so the engine suite never ran in that baseline. Confirmed separately: `cd packages/frontend/engine && bun test` = 1444 pass / 3 fail (asset-only, see below). |
| `bun moon run frontend-engine:typecheck client:typecheck` | clean |

Independently demonstrated pre-existing failure (NOT caused by this work):

- `packages/frontend/engine` → `Per-pack content audit (C-376 AC-6)` 3 failures:
  `game-data/sprites/tilesets/props.webp`, `props.json`, `atlas.json` do not
  exist. Neither this worktree nor the root checkout contains a `game-data/`
  directory, so the asset setup the test prescribes is absent on both. The
  audit does not touch combat code.

## 7. Checkpoint 1 — COMPLETE (see §8 for what it does NOT cover)

Repairs landed, each with regression coverage:

| # | Status | What changed |
|---|---|---|
| F2 | ✅ fixed | New `combat_ai_lifecycle.ts` owns ONE time budget per request group and ONE provider transport per call. A soft timeout now **aborts the outstanding transport immediately** (the pinned alternative to leaving a tracked hard-abort alive), so no provider call is left running unobserved. Retries consume the remaining budget instead of restarting the soft window; a provider rejection is not retried inside the budget. The narration service uses the same discipline. |
| F3 | ✅ fixed | Single and batch decisions share one lifecycle: every decision id owns a slot, a batch is N slots over one transport, `_settle` is once-only, cancelling a member releases only that member, and the shared transport is aborted only when the LAST member releases. Typed `'cancelled'` reason added (amendment 3.0.2) so cancellation is no longer collapsed into `stale`/`offline`. Telemetry is one record per attempt per decision. Terminal results live in a bounded LRU. |
| F4 | ✅ fixed | `EncounterRunTracker` (authored id + monotonic generation) is owned by the ViewModel and threaded into the AI controller. Cache keys, `currentState` reuse, `serveRequest`, prefetch writes and narration callbacks all compare run identity, so a retry of the same authored encounter cannot consume leftover work. `COMBAT_ENDED` and disposal end the run, cancel outstanding work, clear in-flight bookkeeping. `inFlight` is released in a `finally` (batch throw / context-construction failure included). |
| F5 | 🟡 half fixed | **Perception: fixed.** `buildCombatDecisionContext` no longer defaults to every living combatant. `derivePerceivableCombatantIds` (self + own team + hostiles with clear LoS from `battlefield.blocksSight`) is the documented safe default; a caller mask still narrows it. `trimToTokenBudget` now bounds strings too and returns a typed `undefined` fallback instead of an over-budget context. **Character policy: wired, unverified at prompt level** — `buildCombatPolicyFromNpc` projects authored `voice`/`manner`/`boundaries`/class/approval onto the roster, it is pinned onto the engine AI coordinator as `policyByCombatant`, and prompt-level fixtures for it are still outstanding. |
| F6 | ✅ fixed | Prefetch now walks forward from the LIVE initiative position and batches only one knowledge group (the team of the first upcoming AI actor), so a companion and an enemy can never share a prompt. |
| F1 | 🟡 partial | `controlMode` now has a real runtime effect: it travels on the encounter roster, is stored on the `Companion` component, and `direct` makes the turn player-owned (`controllerFor`/`isPlayerControlled`; `runV2AiTurns` stops on it). **Missing:** Suggest proposal/edit/approve, Intent standing goal, live mid-encounter switching, the mode-selection UI. |
| F7 | ⬜ not done | `combat_narration_policy.ts` still uses substring lists. Narration ordering/idempotency WAS repaired (slot reserved synchronously, rewritten in place, late callbacks dropped by run identity). |
| F8 | ⬜ not done | The enabled-agent production E2E lane does not exist. |
| F9 | ✅ corrected | The contract's Execution Report is no longer "Pending"; it now records real files, tests, deviations and open criteria, and amendment 3.0.2 records every schema/behaviour change. `PROGRESS.md`'s `👍 approved` column is a *promotion* state, not a claim of completion, so it was left alone (the contract `status: implemented` is accurate). |

### 7.1 Verification (checkpoint 1)

| Command | Result |
|---|---|
| `bun moon run schemas:test` | 754 pass / 0 fail |
| `bun moon run client:test` | 3222 pass / 0 fail (7 skip, 2 todo) |
| `cd packages/frontend/engine && bun test` | 1449 pass / 3 fail — all 3 are the pre-existing `game-data/` asset audits |
| `bun moon run frontend-engine:typecheck client:typecheck` | clean |
| `bunx biome check` (all touched files) | clean |

### 7.2 Known follow-ups from checkpoint 1

- `packages/frontend/engine` moon project id is `engine`, not `frontend-engine`.
  `docs/architecture/combat_2.md` and the bundle guidance say `frontend-engine`;
  the mismatch silently skipped the engine suite in the baseline.
- The legacy collision funnel's `policyByCombatant` is collected but the funnel
  roster authors no policies, so map-triggered encounters get neutral character
  defaults until the content pack is consulted there too.

## 8. Checkpoint 2 — COMPLETE (all remaining C-526 criteria)

| # | Status | What changed |
|---|---|---|
| F7 | ✅ fixed | **Narration authority is structural, not lexical.** `CombatNarrationDraft` is now `{ claims: NarrationFactRef[]; flavor?: string }`. Every mechanical sentence is rendered by `renderNarrationClaim` from the fact it references; an unresolvable reference rejects the whole draft. The flavour channel is admitted only when it names no combatant, carries no digit, uses no outcome vocabulary, and is not the entire narration. "Defeat authorises a victory sentence" and "one actor's defeat authorises another actor's death" are not expressible. |
| F1 | ✅ fixed | **All four modes through the same kernel.** `direct` = the player owns the turn (the AI runner stops). Suggest/Intent/Autonomous = the engine defers and the client presents a compiled proposal with costs/risks, target and approach edits that recompile and re-preview, and a single commit on **Approve** — including with no model, where the proposal comes from the deterministic planner expressed as intent steps. Intent persists a bounded goal into the actor policy. Mode is a persisted roster preference (default `suggest`, old saves load). Mode changes reach the engine mid-encounter; switching to `direct` withdraws the pending proposal. Companion turns have **no model deadline**. New modules: `combat_companion_flow.svelte.ts`, `companion_control_panel.svelte`. |
| F5 (policy) | ✅ fixed | Authored `voice`/`manner`/`boundaries`/class/approval project onto the roster and are pinned as `policyByCombatant`; a companion's standing goal reaches the prompt as its own line. `secrets` are never projected. |
| F8 | ✅ done | New `client-llm-on` Playwright lane against a second client dev server with `PUBLIC_COMBAT_LLM_AGENTS=1` and no reachable provider: degradation with model-unavailable wording (never "agent layer off"), telegraph, template narration, Suggest propose→edit→approve, mode change + Intent persistence. **3 pass / 0 fail.** |
| F9 | ✅ done | Contract execution report rewritten with real files, deviations, per-AC status and exact results; amendments 3.0.2/3.0.3 record every schema and behaviour change. |

### 8.1 Bugs the E2E caught (both now fixed and covered)

1. **Proposal-drop deadlock.** `invalidate()`/`setMode()`/`reset()` dropped an
   open proposal without releasing the engine's turn. Because an
   approval-required turn has NO model deadline, the encounter then waited
   forever. Every abandon path now submits `decision: null` (except the engine's
   own withdrawal). Covered by `combat_companion_flow.test.ts`.
2. **Approval surface below the fold.** The companion panel sat at the bottom of
   a scrollable pane, so an approval the fight was waiting on was invisible
   without scrolling. It is now mounted high in the pane.

### 8.2 Verification (checkpoint 2)

| Command | Result |
|---|---|
| `bun moon run schemas:test` | 758 pass / 0 fail |
| `bun moon run constants:test` | 164 pass / 0 fail |
| `bun moon run client:test` | 3248 pass / 0 fail |
| `cd packages/frontend/engine && bun test` | 1460 pass / 3 fail — the 3 pre-existing `game-data/` asset audits |
| `bun moon run schemas:typecheck client:typecheck frontend-engine:typecheck e2e:typecheck` | clean |
| `bun run build:emulator` (client) | build + `check_bundle` pass |
| flag-OFF combat E2E (`--project=client combat_v2`) | 12 pass / 0 fail |
| flag-ON enabled lane (`--project=client-llm-on combat_v2_llm`) | 3 pass / 0 fail |

### 8.3 Incidental fixes

- `combat_v2.spec.ts`'s "no model call was made" probe matched `/text/` anywhere
  in a URL — including the app's own `/_app/immutable/workers/text_llm_worker-*.js`
  chunk. Same-origin requests are now excluded. Verified pre-existing by running
  the same test on a clean `origin/main` worktree (3/3 attempts failed there
  too, earlier, at `bootIntoGame`).
- `DEFAULT_BASIC_ATTACK_ABILITY_ID` must not be re-exported from the engine
  barrel: the bundle guard (`check_bundle`) fails because the minifier inlines
  it and drops the binding while the dynamic-import namespace getter still names
  it. The client uses `BASIC_MELEE_ABILITY_ID` from `@aikami/constants`.

## 9. Remaining work (deliberately NOT started)

C-527 (Combat-07 — objects, affordances, improvised actions) and C-528
(Combat-08 — objectives, morale, reactions, release gate) are **not drafted and
not implemented**, per the instruction to leave them alone. Consequences worth
recording:

- The proof encounter from `combat_2.md` §21.4 / §26 is not complete: it needs a
  table/brazier/oil/breakable support, a non-kill objective or morale outcome, and
  a reaction. None of those exist yet.
- The §22.2 legacy-removal gate is untouched. Legacy combat is still the default
  (`PUBLIC_COMBAT_ENGINE` unset) and nothing was deleted.
- `combat_narration_policy.ts` covers the CURRENT event vocabulary. C-527/C-528
  introduce surface, condition, objective and morale events, and the fact
  vocabulary must be extended with them (noted in the policy header).

## 9. Blocker register

| Blocker | Affected criteria | Detail |
|---|---|---|
| Enabled-agent E2E lane not built | C-526 AC-10, and later C-527/C-528 release gates | Needs a controlled provider fixture through the production composition boundary; no deterministic model backend ships in the repo. |
| No live mode-switch bridge command | C-526 AC-6 | Changing a companion's mode mid-encounter needs a new bridge command + worker dispatch; selecting a mode today takes effect at encounter start. |
| `game-data/` assets absent in every checkout | Nothing in combat scope | Pre-existing 3 engine test failures; needs the prescribed asset setup. |

