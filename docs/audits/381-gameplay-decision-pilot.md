# #381 lane C — one measured gameplay decision: **NO-GO for live routing**

Branch `perf/381-measured-gameplay-decisions`, based on `29cc1d745`
(`#424` Lane B merged, `#423` Lane A merged).

## Decision

**No decision checkpoint qualifies for automatic gameplay routing on this task,
and none can be made to qualify by choosing a better threshold.** The opt-in
consumer ships, is gated so it cannot route today, and the settings UI keeps
refusing automatic gameplay — but that refusal now names a task at a version
with a measurement behind it, instead of "the workload pilot has not landed".

Two things were built and are real:

1. **A real production decision**, derived from authoritative world state, with
   real content-pack payload IDs and first-class no-action semantics. It closes
   a **live authorization defect** (§2).
2. **A four-arm comparison** on a corrected corpus, one shared scorer, frozen
   gates, conditions established by dispatch order.

One thing was measured and did not work. It is reported as a failure.

## 1. The decision, stated exactly

> Given an exchange, and the set of actions **this NPC is currently permitted to
> take**, which single action does the NPC take — or none?

Not "what did the player ask for". A player requesting a quest is a request, not
a grant.

**Candidates are enumerated before the model is consulted**, from the same world
state the precondition validator reads (`enumerateNpcActionCandidates`):

| Source of truth | Candidate |
|---|---|
| `questStateService.getOfferableQuests(npcId)` | `offerQuest:fading_ward`, … |
| `npcEntry.vendorInventory` (comma-joined, split) | `giveItem:healthPotion`, … |
| `getDiscoverableEvidence()` filtered `presentToNpcId === npcId` | `presentEvidence:the_ledger`, … |
| `isVendor` / `isCompanion` / `combatStats` | `trade`, `recruit`, `startCombat` |
| always present | `none` |

Every option carries the real id. The model chooses an id **we already resolved**;
it never invents one, and it never authorises anything. The widest real NPC
(`merchant`) yields 11 candidates, inside the default bound of 16.

`skillCheck` is deliberately **absent**, and the omission is reported rather than
dropped: `difficultyClass` is a per-exchange judgement with no authoritative
enumeration, so including it would put 48 legal-but-meaningless options in front
of the model.

## 2. A live authorization defect this closes

In `npc_dialogue_service.svelte.ts`:

- `_deriveAllowedCommands` pushes `offerQuest` for **every** NPC
  (`// Any NPC can offer a quest (gated by per-quest precondition in dispatch)`);
- the `offerQuest` precondition checks only that `contentProvider.getQuest(questId)`
  returns a quest;
- `getQuest` **does not expose `offeredByNpcId`**, so the per-offerer gate cannot
  be evaluated there.

All four Emberwatch quests have an `offeredByNpcId`. So today the model can make
**Elder Thalia offer `tools_for_tomorrow`, which Orra owns**, and the
precondition passes. Enumerating from `getOfferableQuests` removes that option
from the set — it cannot be selected because it is never offered.

`_validateCommandPreconditions` and `executeCommand` are **unchanged**. This
narrows the reachable set; it does not replace the game's validator and does not
touch mutation ownership.

## 3. The comparison

One corpus, one scorer (`metrics.ts`: `scoreResult` / `foldOutcome` /
`summarizeTally` / `evaluateQualityGates`), one set of frozen gates. Only the
inference mechanism differs per arm.

The driver compiles a **per-case** plan from that case's own candidate set.
`evaluateBackend` compiles one static plan, which is right for the probe and
wrong here: two NPCs in one conversation have different legal actions, and
scoring a turn against the union would hand the backend a menu of actions that
NPC cannot take — the exact defect this task removes. The **scorer is not
forked**; only the dispatch loop is local.

Gates, frozen before scoring: recall ≥ 0.85, false acceptances **= 0**, rate
≤ 0.05, coverage ≥ 0.90, legal value rate = 1.0, warm p50 ≤ 250 ms, warm p95
≤ 750 ms, cold p95 ≤ 4000 ms.

### Held-out results — 33 cases, 15 positive / 18 required-abstain

| Arm | positive recall | false acceptances | coverage | warm p50 | warm p95 | Gate |
|---|---|---|---|---|---|---|
| deterministic lexicon (control) | 0.417 | **6** | 0.367 | 0 ms | 1 ms | FAIL |
| **existing LLM path** `qwen3:14b` | **0.250** | 0 | 0.967 | **8626 ms** | 14258 ms | FAIL |
| `systemone:tev1` (4.48 GB) | 0.000 | 0 | 0.100 | 6145 ms | 9565 ms | FAIL |
| `systemone:nimble` (9.53 GB) | 0.083 | 0 | 0.600 | 7723 ms | 11878 ms | FAIL |

Three things worth reading off this table.

**The existing LLM path is the slowest arm by ~24×.** Asked the identical closed
question, JSON-schema-constrained, it takes a warm p50 of **8.6 seconds** to get
**25 %** of positives right. That is the "expensive work" this task was meant to
remove, now quantified rather than asserted.

**The deterministic control proves the safety metric is load-bearing.** It has
the best recall of the four (0.417) and the only false acceptances (**6**, a
33 % rate) — a keyword lexicon fires real actions at real NPCs on messages that
asked for nothing. A recall-only comparison would have ranked it first.

**Neither checkpoint can stay warm.** `tev1`'s warm latencies run
min 2 ms / p50 6145 ms / max 10107 ms, with **26 of 27 samples over one second**,
on an otherwise-idle RTX 4090 Laptop. A 4.48 GB checkpoint is being evicted and
reloaded rather than served. The latency numbers are a residency measurement as
much as a speed measurement.

### Calibration — why no threshold can rescue either checkpoint

Thresholds were declared blind on the first run and rejected correct answers.
Re-running the **development split only** with no selective-acceptance policy
shows what each checkpoint would actually answer, and how sure it is:

| | `tev1` | `nimble` | deterministic | `qwen3:14b` |
|---|---|---|---|---|
| dev positives correct | 3 / 9 | 2 / 9 | 4 / 9 | 3 / 9 |
| false acceptances | 0 | 0 | 3 | 0 |
| p(chosen \| correct) | 0.40 – 0.77 | **0.994** | — | — |
| p(chosen \| wrong) | 0.49 – 0.89 | **0.978** | — | — |

`nimble`'s single correct answer carried p = 0.994; its wrong answers carried
p = 0.978. `tev1` is the same story spread wider: wrong `none` answers at 0.79,
0.83, 0.89 against correct answers at 0.40, 0.66, 0.77.

**Confidence does not separate right from wrong.** So the selective-acceptance
trade is unwinnable in both directions:

- **Raise** the accept threshold → the confident wrong answers survive as false
  acceptances, and the gate demands **zero**.
- **Lower** it → more wrong answers survive; recall was already far below 0.85.

Both checkpoints are **confidently abstaining on real actions**, not cautiously
unsure. That is a task-quality failure, not a calibration failure, and it is the
finding. Selective acceptance — the main argument for a decision model over an
LLM — does not function here.

### A prompt defect I found and fixed first

The first run had every checkpoint answering `none` almost everywhere. Before
recording that as a model result I checked my own task, and it was partly mine:
option descriptions read *"This NPC may offer X, and the exchange is the right
moment to put it to the player."* A rarely-true compound condition on **every**
option reads as "almost never". The wording is now a plain description of what
each action **is**, byte-identical between the production enumerator and the
corpus generator:

> `Offer the quest "The Fading Ward" to the player.`

That moved `tev1` from 2/9 to 3/9 and `nimble` from 1/9 to 2/9 — a real
improvement, still far below the gate. Both iterations are reported.

## 4. Why this is a NO-GO rather than a threshold to tune

- Recall is 0.00–0.08 against a required 0.85, and the gap is a bias, not noise.
- Confidence does not separate right from wrong, so selective acceptance — the
  whole mechanism — is unavailable.
- Latency fails **independently**: warm p50 6.1 s and 7.7 s against a 250 ms
  budget, and the cause is residency, not throughput.
- No arm passed, including the deterministic control and the existing LLM path.
  The corpus is hard enough that nothing clears it, which is itself information.

I did **not** force live routing, and did not move a gate to manufacture a pass.

## 5. What the consumer does

`npcActionDecisionService` + `npc_action_turn.ts` + `npc_action_candidates.ts` +
`npc_action_selection.ts`. Each required property, and where it is enforced:

| Requirement | Enforced by |
|---|---|
| qualified **task / task version / checkpoint / dialect** only | `resolveNpcActionRoute` — four distinct refusals (`task-mismatch`, …) |
| shares the logical deadline | `deadlineAt` is the turn's one absolute budget, passed to `runDecision`; never restarted |
| correct resource admission | runs inside the turn's existing admission and deadline, not beside it |
| rejects stale state / campaign / conversation | `isStaleNpcActionResult` — campaignId, conversationId, turnSequence, stateRevision, plus a config generation counter |
| preserves domain validators | `_validateCommandPreconditions` still runs on whatever comes back |
| exactly-once mutation ownership | `executeCommand` untouched; the consumer never applies a mutation |
| falls back **once** on remaining budget | only an abstention earns a fallback; `hasFallbackBudget` reads the same `deadlineAt` |
| never retries a successful mutation | an **accepted** decision returns `source: 'decision'` and no fallback path exists |
| attempt accounting, no duplicated cost | one attempt per source, recorded once; backend attempt counts are copied, never reconstructed |
| off / on / disable / reload + immediate rollback | `setMode('off')` takes effect on the **next turn** — no restart, no reload, no re-auth |

**Shadow mode** dispatches and discards, so the comparison can accumulate against
real gameplay. It is deliberately **not** gated on qualification (otherwise it
could never produce the evidence that would qualify a backend), but it **is**
refused for an incomplete candidate set.

When the decision answers, call 2 is narrowed to
`NpcDialogueChoicesExtractionSchema` — `choices` is generative and no decision
model produces it, so **call 2 still runs**. `choices` is the workload
limitation: this replaces the `command` half of call 2, not all of it.

## 6. Limitations — stated, not buried

- **The workload limitation is real.** Only `command` is decision-shaped.
  `choices` needs player-facing labels and authored dialogue keys. Full call-2
  elimination is not available with the models measured here.
- **The corpus is authored, not observed.** Labels are a written specification.
  It grades agreement with that spec and cannot detect a spec that is itself
  wrong. A NO-GO on an authored corpus is a weaker claim than one on telemetry.
- **English only.** Neither checkpoint declares another language, so there is no
  multilingual slice; any non-English turn must abstain by construction.
- **One split of exchanges, not of content.** Both NPCs and exchanges are
  authored; held-out is a split of exchanges, not of the content pack.
- **GPU residency is only partly characterised.** tev1 (4.48 GB) + nimble
  (9.53 GB) + the narrative model (9.28 GB) exceed the 16 GB card, so true
  steady-state co-residency is unmeasured. Latency figures are single-model on an
  otherwise-idle GPU and should be read as a **lower bound** for a live session.
- **Cold p95 is under-sampled** (three labelled cold samples per split). The
  scorer correctly withholds a cold percentile rather than rounding three numbers
  into a p95.

## 7. Demonstration path

```
setup     → configure Ollama >= 0.35.0 + a decision checkpoint in AI settings
sample    → "Test connection" runs a REAL sample decision (readiness, not a model list)
task      → npc-action-selection is listed, and is NOT qualified
gameplay  → mode `off`    → existing LLM path, unchanged
          → mode `shadow` → decision dispatched, answer discarded, turn unchanged
          → mode `on`     → REFUSED today: qualification never passes
fallback  → an abstention spends remaining budget on the existing path, once
disable   → mode `off`, next turn; no restart, no reload
```

Live routing is refused at the last two steps. That refusal is the measured
outcome, not a missing feature.

## 8. Remaining #381 criteria

- "At least one actual enum/boolean call site end-to-end" — **partially**: the
  consumer ships and is reachable, but qualification is closed, so no turn is
  *routed*.
- A checkpoint clearing the frozen gate — **not met**. No candidate did.
- Managed/bundled runtime — **not attempted**, deliberately: nothing qualified.
- Warm/cold p50/p95, memory, accuracy, fallback frequency — measured for
  accuracy and latency. **Frame-time impact in a live session was not measured.**
- laya.cpp / hosted Jev — **not measured**: unavailable here without a paid
  credential, and nothing qualified to justify the spend.

## 9. Reproduction

```bash
# An ISOLATED 0.35.0 daemon. The pinned 0.34.4 returns 404 on /v1/systemone, so
# no decision checkpoint is measurable on the default setup at all.
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/tmp/aikami-381/models381 ollama serve
ollama pull tev1 && ollama pull nimble

bun scripts/evaluation/decision/generate_npc_action_corpus.ts
bun scripts/evaluation/decision/run_npc_action_selection.ts \
  --endpoint http://127.0.0.1:11435 --model tev1,nimble \
  --chat-model qwen3:14b --out .evidence/381/npc-action-selection.json

# calibration: development split only, no thresholds
bun scripts/evaluation/decision/run_npc_action_selection.ts --calibrate \
  --arms systemone:nimble --endpoint http://127.0.0.1:11435 --model nimble
```

Exit codes: `0` measured, `1` gate failed, `2` backend unavailable. Unavailable is
never reported as a pass — during this work a daemon death mid-run was recorded
as `UNAVAILABLE (runtime version probe failed)` rather than a result.