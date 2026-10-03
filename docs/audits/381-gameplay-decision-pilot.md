# #381 lane C — one measured gameplay decision: **NO-GO for live routing**

Branch `perf/381-measured-gameplay-decisions`, based on `29cc1d745`
(`#424` Lane B merged, `#423` Lane A merged).

Raw per-case outcomes: [`381-evidence/`](381-evidence/) — run IDs, corpus hashes,
runtime identity, conditions and one row per scored case.

## Decision

**No decision checkpoint qualifies for automatic gameplay routing on this task,
and no threshold can make one qualify.** The opt-in consumer ships, is gated so it
cannot route today, and the settings UI keeps refusing automatic gameplay.

Two things were built and are real:

1. **A real production decision**, derived from authoritative world state, with
   real content-pack payload IDs and first-class no-action semantics. It closes a
   **live authorization defect** (§2) in the dispatch gate itself, not only in
   the candidate set.
2. **A four-arm comparison** on a corrected corpus, one shared scorer, frozen
   gates, and latency conditions established from **runtime residency evidence**
   rather than request position.

---

## 0. Corrections made to this lane's own earlier work

An earlier revision of this report and harness is on the branch history. Four
things in it were wrong, and are corrected here rather than quietly amended.

| Earlier claim | What was actually true |
|---|---|
| Held-out scored **30 cases / 12 positives** | The corpus declares **33 / 15**. A positional warm-up discarded fixture indices 3–5 — all positives — so the denominator was silently wrong and biased by authoring order. |
| "cold/warm" from the first three dispatches | Labelling by request position is an assumption, not a measurement. Conditions now come from the runtime (`ollama:/api/ps`), and an unverifiable condition is recorded as **cold** so it never enters the warm aggregate. |
| "the existing LLM path is the slowest arm by ~24×" | **Withdrawn.** It compared a 9.5 s arm against a deterministic baseline reported as `0 ms`, which is not a ratio against anything. |
| tev1 latency explained as "the checkpoint will not stay resident / is evicted and reloaded" | **Withdrawn.** It was never measured. Residency is now observed directly, and that diagnosis was wrong. |
| "the widest real NPC (`merchant`) yields 11 candidates" | It yields **8**: `none`, `trade`, and six `giveItem`. The merchant has no quest it may offer and no evidence addressed to it. |

---

## 1. The decision, stated exactly

> Given an exchange, and the set of actions **this NPC is currently permitted to
> take**, which single action does the NPC take — or none?

Not "what did the player ask for". A player requesting a quest is a request, not
a grant.

**Candidates are enumerated before the model is consulted**, from the same world
state the precondition validator reads:

| Source of truth | Candidate |
|---|---|
| `questStateService.getOfferableQuests(npcId)` | `offerQuest:fading_ward`, … |
| `npcEntry.vendorInventory` (comma-joined, split) | `giveItem:healthPotion`, … |
| `getDiscoverableEvidence()` filtered `presentToNpcId === npcId` | `presentEvidence:the_ledger`, … |
| `isVendor` / `isCompanion` / `combatStats` | `trade`, `recruit`, `startCombat` |
| always present | `none` |

Each family is additionally gated on its **kind whitelist**: an NPC not permitted
to present evidence is not offered evidence options at all. The widest real NPC
(`merchant`) yields **8** candidates; the default bound is 16.

`skillCheck` is deliberately **absent**, and the omission is reported rather than
dropped: `difficultyClass` is a per-exchange judgement with no authoritative
enumeration, so including it would put 48 legal-but-meaningless options in front
of the model.

---

## 2. A live authorization defect, closed in the GATE

The earlier revision claimed this was closed by the candidate enumeration. **That
was incomplete**: with decision routing off (the default) or after an abstention,
the command still comes from the text model and still reached the old
precondition.

In `npc_dialogue_service.svelte.ts`:

- `_deriveAllowedCommands` pushes `offerQuest` for **every** NPC, stating "gated by
  per-quest precondition in dispatch";
- that precondition checked only that `contentProvider.getQuest(questId)`
  returned a quest;
- `game_composition_root` omitted `offeredByNpcId` from the quest projection, so
  the precondition had no way to know **who owns** the quest.

On Emberwatch every quest names its offerer, so **any NPC could be driven to offer
any other NPC's quest and the dispatch succeeded** — Elder Thalia offering the
smith's errand.

The fix is in three places, and the gate is now the authority:

1. `game_composition_root` passes `offeredByNpcId` through (it was declared on
   the provider's own return type and withheld by omission);
2. `questOfferPrecondition` authorizes on `getOfferableQuests(npcId)`, which
   filters on ownership **and** current offerability;
3. it runs on the default-off path **and** at `executeCommand`, so a
   model-supplied command is authorized identically to a chosen one.

`npc_dialogue_quest_authorization.test.ts` pins all three, including that a
quest the NPC *does* own is still allowed — a suite that refused everything would
pass without proving anything.

---

## 3. The comparison

One corpus, one shared scorer (`metrics.ts` — `scoreResult` / `foldOutcome` /
`summarizeTally` / `evaluateQualityGates`), frozen gates. Only the inference
mechanism differs per arm.

The driver compiles a **per-case** plan from that case's own candidate set:
two NPCs in one conversation have different legal actions, and scoring a turn
against the union would hand the backend a menu of actions that NPC cannot take.
The **scorer is not forked**; only the dispatch loop is local.

Gates, frozen before scoring: recall ≥ 0.85, false acceptances **= 0**, rate
≤ 0.05, coverage ≥ 0.90, legal value rate 1.0, warm p50 ≤ 250 ms, warm p95
≤ 750 ms, cold p95 ≤ 4000 ms.

### Held-out — 33 cases, 15 positive / 18 required-abstain, every case scored once

| Arm | recall | false acc | coverage | warm p50 | warm p95 | residency verified | Gate |
|---|---|---|---|---|---|---|---|
| deterministic lexicon (control) | 0.400 | **6** | 0.364 | 0 ms | 0 ms | in-process | FAIL |
| **existing LLM path** `qwen3:14b` | **0.333** | **1** | 0.970 | **unverified** | **unverified** | no | FAIL |
| `systemone:tev1` | 0.000 | 0 | 0.121 | **11781 ms** | 13951 ms | `ollama:/api/ps` | FAIL |
| `systemone:nimble` | 0.067 | 0 | 0.333 | **15114 ms** | 27840 ms | `ollama:/api/ps` | FAIL |

`denominatorProblems` is **empty** for every arm: 33 declared, 33 scored, 15
positives declared, 15 scored.

Four things this table says that the previous one could not:

**The control proves the safety metric is load-bearing.** Best recall of the four
(0.400) and the only large false-acceptance count — 6 actions fired at real NPCs
on messages that asked for nothing, a 33 % rate against a ceiling of 0. A
recall-only comparison ranks this arm first.

**The chat comparator cannot state a warm latency at all.** Its endpoint exposes
no residency route, so every case is recorded `cold` and the warm gate refuses:
`warm p50 latency gate could not be evaluated: warm condition was not
established`. That is the honest outcome, and it is why this arm's latency is
reported as unverified rather than as a number.

**The checkpoints are residency-verified and still far outside the budget.**
`/api/ps` reported the checkpoint loaded for 53 of 53 scored cases, yet warm p50
is 11.8 s and 15.1 s against a 250 ms budget. The earlier "eviction" explanation is
withdrawn; the measurement says the model was resident and still slow.

**Those figures are an upper bound under contention, not a clean-GPU number.** A
narrative checkpoint (9.3 GB) and a decision checkpoint (4.5 GB / 9.5 GB) were
resident in the same 16 GB card for part of the run, and co-residency was not
isolated. What can be said: residency was confirmed, and neither checkpoint
answered inside the interaction under these conditions.

### Call and timing accounting — separated

The earlier report counted none of this. Each arm now separates them, and a probe
is never reported as inference:

| Arm | readiness probes | warm-up dispatches | residency observations | scored inference dispatches | setup / probe / inference ms |
|---|---|---|---|---|---|
| `tev1` | 1 | 2 | 55 | 53 | 10.6 / 2.9 / 49343 |
| `nimble` | 1 | 2 | 55 | 53 | 7.9 / 0.8 / 346415 |

The chat comparator runs **one** readiness probe per arm, not one per case; that
was verified rather than assumed. The probe is a real generation, which is why it
is now timed and counted on its own line.

### Calibration — why no threshold rescues either checkpoint

Re-running the **development split only** with no selective-acceptance policy
shows what each checkpoint would answer. The decisive observation is that
confidence does not separate right from wrong: `nimble` answered its one correct
held-out positive at p≈0.99 while answering `none` confidently on the wrong ones,
and `tev1`'s wrong answers clustered at higher confidence than its right ones.

Under the declared thresholds, 29 of 33 (tev1) and 22 of 33 (nimble) held-out
cases end as `below-accept-threshold` — visible per case in the exported
evidence. So the trade is unwinnable in both directions:

- **Raise** the accept threshold → confident wrong answers survive as false
  acceptances, and the gate demands **zero**.
- **Lower** it → recall was already 0.00–0.07.

Both checkpoints are **confidently abstaining on real actions**. Selective
acceptance — the main argument for a decision model over an LLM — does not
function here.

---

## 4. Why this is a NO-GO

- Recall 0.00–0.40 against a required 0.85, and the gap is a bias, not noise.
- Confidence does not separate right from wrong, so selective acceptance is
  unavailable as a safety mechanism.
- Latency fails independently: warm p50 11.8 s / 15.1 s against 250 ms, with
  residency confirmed rather than assumed.
- No arm passed — including the control and the existing path.

No gate was moved to manufacture a pass.

---

## 5. What the consumer does, and what it does not

| Required behaviour | Implemented where |
|---|---|
| qualified **task / version / dialect / checkpoint** | `resolveNpcActionRoute` (four separate refusals) **and** `resolveNpcActionQualification` |
| fails closed without versioned evidence | `resolveNpcActionQualification` — no recorded evidence ⇒ refuse |
| shares the logical deadline | one absolute `deadlineAt`; never restarted |
| rejects stale campaign / conversation / turn / world / config | `isStaleNpcActionResult`, all five read live |
| preserves domain validators | `_validateCommandPreconditions` still runs on every command |
| exactly-once mutation ownership | `executeCommand` untouched; the consumer never mutates |
| falls back **once**, on remaining budget | only an abstention earns a fallback |
| never retries a successful mutation | an accepted decision has no fallback path |
| off / on / disable / reload | `setMode('off')` applies on the **next turn** |
| shadow does not delay the turn | dispatched concurrently, bounded to a slice of remaining budget |

**Corrected honestly, because the previous report over-claimed:**

- **Resource admission is NOT reused.** The decision backend is a different
  resource on the same GPU, not a second item in the text queue, and routing it
  through the text admission queue would misreport its contention domain. What
  is real: it runs inside the turn's existing deadline and admission, after
  narrative streaming ends, and is bounded by a slice of the remaining budget.
- **Attempt accounting is recorded per resolution** and now separated in the
  harness (probe / warm-up / inference). It is **not** yet fused into
  `textTelemetryService` spans with a parent turn id; that remains open work.
- **Cold load is not characterised** for either checkpoint. Residency was
  confirmed warm for the scored cases; the cold path was exercised by the warm-up
  dispatches and not measured as a distribution.

### Live staleness, not a captured getter

The first implementation captured the campaign id once and passed the captured
value back as the "current" one, so a campaign switch mid-flight could not be
seen; `turnSequence` was also a captured value, so the **next turn** looked
identical to the current one. Both are now readers, and the world revision is
computed from the same live queries that build the candidate set — so a change
that alters what is legal necessarily alters the revision.

---

## 6. Limitations

- **Only `command` is decision-shaped.** `choices` is generative (labels, authored
  dialogue keys) and no decision model produces it, so **call 2 still runs**,
  narrowed to `NpcDialogueChoicesExtractionSchema`. Full call-2 elimination is
  not available with these models. This is the workload limitation.
- **The corpus is authored, not observed.** A NO-GO on an authored corpus is a
  weaker claim than one on telemetry.
- **English only.** Neither checkpoint declares another language; there is no
  multilingual slice, and non-English turns must abstain by construction.
- **One split of exchanges, not of content.**
- **GPU contention uncharacterised** (see §3). Latency figures are residency-
  verified but not contention-isolated.
- **Frame-time impact in a live session was not measured.**
- **Runs were executed in three invocations** (decision arms, then baseline arms)
  because the chat comparator alone exceeds a 30-minute cap. Each artifact
  carries its own run id, corpus hash, command and runtime identity; the four arms
  are otherwise measured under identical gates, corpus and harness.

---

## 7. Demonstration path

```
setup     → configure Ollama >= 0.35.0 + a decision checkpoint in AI settings
sample    → "Test connection" runs a REAL sample decision
task      → npc-action-selection is listed, and is NOT qualified
gameplay  → off    → existing LLM path, unchanged
          → shadow → decision dispatched concurrently, discarded, turn not delayed
          → on     → REFUSED today
fallback  → an abstention spends remaining budget on the existing path, once
disable   → mode `off`, next turn; no restart, no reload
```

---

## 8. Remaining #381 criteria

- One enum/boolean call site end-to-end — **partially**: the consumer ships and is
  reachable; qualification is closed, so no turn is *routed*.
- A checkpoint clearing the frozen gate — **not met**.
- Managed/bundled runtime — **not attempted**; nothing qualified.
- Telemetry span fusion with parent turn id — **not done** (attempt accounting is
  recorded, not yet reported through `textTelemetryService`).
- laya.cpp / hosted Jev — **not measured**.

---

## 9. Reproduction

```bash
# An ISOLATED 0.35.0 daemon. The pinned 0.34.4 returns 404 on /v1/systemone, so
# no decision checkpoint is measurable on the default setup at all.
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/tmp/aikami-381/models381 ollama serve
ollama pull tev1 && ollama pull nimble

bun scripts/evaluation/decision/generate_npc_action_corpus.ts

bun scripts/evaluation/decision/run_npc_action_selection.ts \
  --endpoint http://127.0.0.1:11435 --model tev1,nimble \
  --arms systemone:tev1,systemone:nimble \
  --out .evidence/381/npc-action-selection-decision-arms.json

bun scripts/evaluation/decision/run_npc_action_selection.ts \
  --endpoint http://127.0.0.1:11435 --model tev1 \
  --arms deterministic,chat-llm:qwen3:14b --chat-model qwen3:14b \
  --out .evidence/381/npc-action-selection-baseline-arms.json

# Sanitized, reviewable per-case outcomes
bun scripts/evaluation/decision/export_sanitized_evidence.ts \
  --in .evidence/381/npc-action-selection-decision-arms.json \
  --out docs/audits/381-evidence/npc-action-selection-decision-arms.json
```

Exit codes: `0` measured, `1` gate failed, `2` backend unavailable. Unavailable is
never reported as a pass — a daemon death mid-run was recorded as
`UNAVAILABLE (runtime version probe failed)`, not as a result.