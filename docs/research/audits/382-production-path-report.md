# Issue #382 — where the production critical path actually goes

**Status:** measurement only. No behaviour, routing, scheduling or configuration
change is made or proposed for implementation in this PR.

**Provenance.** The runs below were captured on the client build at
`ce5a1db58` (the `main` this work started from), with #412's harness unmerged in
the same working tree. This branch was later rebased onto the merged #412
(`8bc03c899`); **the rebased tree is byte-identical for every file these numbers
came from**, and every figure was re-verified after the rebase. The measurements
belong to `ce5a1db58`; the PR base is `8bc03c899`.

**Configuration measured.** `ornith-1.5:9b` (9B, Q4_K_M), Ollama 0.34.3, native
`/api/chat`, **CPU-only** on an i9-14900HX / 32 cores / 31 GB.
**Raw:** `.evidence/382-baseline/prod-path/report.{md,json}`

> Every magnitude in this report is a property of **this** model, runtime, machine
> and workload. They are not hardware constants and do not transfer to other
> models, GPU or fewer-core machines, longer conversations, or cloud providers.

---

## 1. Where player-visible dialogue latency actually goes

Measured on **real production turns** — `NpcDialogueService.generateTurn`, the
call the game makes when a player talks to an NPC, including its internal C-401
two-call split. Not a synthetic `extractStructure`.

Three consecutive real turns, all `source: 'ai'`:

| turn | wall clock | TTFT | source | schema valid | narrative | choices |
|---|---|---|---|---|---|---|
| 1 | 11 045 ms | 5 043 ms | ai | ✅ | non-empty | 2 |
| 2 | 12 935 ms | 6 934 ms | ai | ✅ | non-empty | 2 |
| 3 | 11 841 ms | 5 839 ms | ai | ✅ | non-empty | 2 |

Phase attribution, summed over the P1 window (3 completed + 3 aborted provider
calls), from the provider's **own** counters:

| phase | ms | share of provider time | source |
|---|---|---|---|
| model load | 3 ms | ~0% | provider `load_duration` |
| **prefill** | **290 ms** | **1.6%** | provider `prompt_eval_duration` |
| **generation** | **17 081 ms** | **96.0%** | provider `eval_duration` |
| client overhead (queue + HTTP + parse) | 7 ms | — | client total 35 805 − provider total 17 800, less the 17 998 ms of aborted calls |
| client overhead **attributable to aborted calls** | 18 005 ms | — | see §4 |
| provider total | 17 800 ms | | provider `total_duration` |
| **total** | **35 805 ms** | | |

Three things this settles that #412 could not:

1. **Generation is ~96% of provider time. Prefill is ~1.6%.** On this Ollama /
   model / hardware dialogue workload, provider-reported prefill is a small share
   of provider time, so **prompt reduction is not currently demonstrated as a
   high-value latency lever for this configuration.** This does **not** generalize
   to longer contexts, other models or hardware, or cloud token cost, where input
   tokens are charged per token and the arithmetic inverts. It is also measured
   on the production path rather than inferred from a synthetic sweep, and it
   agrees with #412's unresolved result.
2. **Client-side overhead is ~7 ms per turn** on this configuration — queueing,
   HTTP and parsing are not the bottleneck here.
3. **TTFT is 5.0–6.9 s, which is 46–59% of the whole turn.** The first narrative
   token takes nearly half the total wait. This is *not* a network or prefill
   effect — it is generation, on a model that emits reasoning tokens the client
   does not forward, so the first *content* token only arrives after the thinking
   is done.

### Combat

`combat-ai` and `combat-narration` are gated behind
`PUBLIC_COMBAT_LLM_AGENTS=1` and **off by default**, and the issue's own claim
that combat already has a decision prefetch is no longer true on `main` — a
whole-tree search finds no combat prefetch. What remains on the default path is
`combat-intent`, one call per AI turn, with a 4 000 ms budget.

**Combat is not measured in this PR.** Doing so would require enabling a
flag-disabled AI feature solely for benchmarking, which is explicitly out of
scope. The `basedOnRevision` stale-decision guard is present and untouched.

---

## 2. Cold vs warm

| | client | **load** | prefill | generation | overhead |
|---|---|---|---|---|---|
| cold (model evicted) | 7 896 ms | **4 759 ms** | 311 ms | 2 808 ms | 3 ms |
| warm (3 calls) | 9 651 ms | **5 ms** | 317 ms | 9 305 ms | 6 ms |

**Model load is 60% of the first call and effectively zero afterwards.** Nothing
was downloaded and no provider was paid: the eviction used Ollama's own
`keep_alive: 0`, which unloads a model already on disk. The load is a one-off
per model residency, not per turn.

**Classification: measured; user impact / frequency unresolved.** A ~4.8 s model
load on the first request is objectively large, and this PR does **not** establish
how often players hit it. Ollama's own `keep_alive` governs residency, so the
frequency depends on runtime configuration, idle timeout and whether the machine
has been suspended — none of which is measured here. No prewarming is
recommended on this evidence, and none is implemented.

---

## 3. Does the MAP_LOADED NPC prefetch harm interactive latency?

> ### ⚠️ WITHDRAWN: the earlier "no demonstrated harm" result was measuring an empty condition
>
> A previous run of this section concluded the burst caused no demonstrable
> interactive harm, and that the effect was unresolvable at n=3. **That result is
> withdrawn.** The burst was not firing: `recordConversation` awaits a digest
> that creates a *fresh* opener, `prefetchForNpcs` then skips that NPC because
> the opener is not stale, and most "overlapped" samples contained **zero
> background calls**. The comparison was between a quiet dialogue and another
> quiet dialogue, which is why it looked like a null result — and why one run
> even produced a *negative* delta.
>
> The numbers below are from a corrected run in which fan-out is **counted per
> sample from the existing client telemetry**, and a sample with zero background
> calls **fails the run** rather than entering the statistics.

### Corrected methodology

- Memory is prepared per sample with a **missing opener**, via the production
  `hydrate` path — no `recordConversation`, so no digest and no model calls
  contaminate the sample. This runs **outside** the measured wire window.
- `prefetchForNpcs` is then fired with the real method and real arguments.
- The burst's actual fan-out is **counted** from client telemetry spans with
  `task: 'summarization'` (the only task on this path that issues those calls) —
  never inferred from the number of NPCs offered.
- The number of background requests **still in flight when dialogue began** is
  computed by comparing wire-row start times against a captured dialogue
  boundary, on the same clock.
- **10 samples** (`--p2-reps 10`), not 3.
- A sample recording zero background calls marks the run invalid and fails it.

### Result: the burst materially harms interactive dialogue

| # | quiet turn | quiet TTFT | overlapped turn | overlapped TTFT | NPCs offered | background calls | still running at dialogue start | valid |
|---|---|---|---|---|---|---|---|---|
| 1 | 12 506 ms | 6 503 ms | 46 782 ms | 40 780 ms | 2 | 2 | 2 | ✅ |
| 2 | 12 233 ms | 6 230 ms | 28 043 ms | 22 040 ms | 2 | 1 | 1 | ✅ |
| 3 | 32 093 ms | 26 091 ms | 72 456 ms | 66 454 ms | 2 | 2 | 2 | ✅ |
| 4 | 11 857 ms | 5 855 ms | 89 479 ms | 83 475 ms | 2 | 2 | 2 | ✅ |
| 5 | 12 778 ms | 6 777 ms | 52 031 ms | 46 029 ms | 2 | 2 | 2 | ✅ |
| 6 | 12 219 ms | 6 216 ms | 43 798 ms | 37 795 ms | 2 | 2 | 2 | ✅ |
| 7 | 11 595 ms | 5 592 ms | 45 593 ms | 39 591 ms | 2 | 2 | 2 | ✅ |
| 8 | 13 114 ms | 7 112 ms | 44 096 ms | 38 092 ms | 2 | 2 | 2 | ✅ |
| 9 | 12 469 ms | 6 467 ms | 46 996 ms | 40 992 ms | 2 | 2 | 2 | ✅ |
| 10 | 12 241 ms | 6 239 ms | 63 116 ms | 57 113 ms | 2 | 2 | 2 | ✅ |

**All 10 samples valid; 19 background summarization calls in total.** Every sample
had at least one background call still running when the dialogue began, so the
overlap is real rather than assumed.

| metric | quiet | overlapped | delta |
|---|---|---|---|
| TTFT median | 6 353 ms | 40 886 ms | **+34 533 ms (+544%)** |
| TTFT range | 5 592–26 091 ms | 22 040–83 475 ms | — |
| wall clock median | 12 355 ms | 46 889 ms | **+34 534 ms (+280%)** |

**Nine of the ten overlapped samples are slower than every quiet sample** on
TTFT. The distributions barely overlap: quiet maximum 26 091 ms, overlapped
minimum 22 040 ms, with only sample 2 inside the quiet range. This is not a
marginal or underpowered result — it is a large, same-sign effect that only
became visible once the burst was actually firing.

The mechanism is consistent with §1: the interactive turn is generation-bound on
a single shared runtime, and the burst runs two more generation-bound calls on
it. With three calls sharing the cores, per-call generation slows several-fold.

**Verdict: demonstrated bottleneck.** Interactive dialogue TTFT rises ~6.4× when a
`MAP_LOADED` NPC opener prefetch overlaps it. This is the largest player-visible
effect measured in this PR, and it is exactly the one the previous run missed.

---

## 4. The one demonstrated bottleneck: every envelope call is aborted

**Every envelope call in this run was aborted at its 6 000 ms deadline — 0
succeeded.** 23 calls, durations 5 999–6 001 ms. The P1 window alone shows 3 of
6 provider requests aborted; the P2 A/B contributes the rest.

Client log, captured during the run:

```
[NpcDialogueService] dialogue:call-failed
  { path: turn-envelope, call: 2, reason: aborted, ms: 6002,
    detail: signal is aborted without reason }
```

This is not a harness artifact. The call **reaches the provider**: it is a real
HTTP request that occupies the runtime for 6 000 ms and is then thrown away.

### Why

- `envelope` has `budgetMs: 6_000` in `TEXT_TASK_PRESETS`.
- Measured decode rate on this hardware: **34.8 ms per completion token**
  (median over **74** completed calls, range 28.5–40.5).
- Capacity, stated once and derived from that single number:

  ```
  affordable completion tokens = (6000 ms − ~60 ms prefill) ÷ 34.8 ms/token ≈ 170
  ```

- The `NpcDialogueAiEnvelope` does not finish within that capacity.

**What we do NOT know:** no envelope completes, so its actual completion-token
requirement is unmeasured. ≈170 is what the budget *can* produce, not what the
call *needs*. The finding is that the current prompt/schema/model combination
does not complete inside 6 000 ms — not that some precise minimum is larger.

The envelope is not failing because the model is unreachable or misrouted — the
call is routed, dispatched, and given its full budget every time. It fails
because **the work does not complete within 6 000 ms on this configuration**,
and it fails *silently*: the span records `cancelled` at 0 ms and the turn
degrades without surfacing anything to the player or the console.

### What the player experiences

- Every turn costs **~11.0–12.9 s**, of which **6 000 ms is a discarded call**.
- The service degrades to narrative-only, and `choiceCount: 2` comes from the
  deterministic `_deriveChoices` fallback — **not** from the model.
- `source: 'ai'` describes the *narrative*, not the envelope. A reader of the
  span alone would conclude the turn was fully AI-generated.

Across the P1 window the discarded call was **50% of total client time**
(`abortedMs` 17 998 of `clientTotalMs` 35 805). The player waits roughly twice as
long as necessary and never receives the model-authored choices the `envelope`
task exists to produce.

### Schema ownership audit (for the proposed fix, not implemented here)

`NpcDialogueAiEnvelopeSchema` is **not** removed or mutated by this PR. The
question is what the *next* PR should do to it, and that needs ownership facts
first.

**Consumers.** Exactly one production consumer: `npc_dialogue_service.svelte.ts`
call 2 (`_extractEnvelope`). The schema also appears in `@aikami/types` (type
re-export) and in the shared schema's own unit tests. No other production module
reads it, and no other service produces this shape.

**Why the semantics have drifted.** The schema was introduced by C-328 for a
**single-call** design where the model produced narrative *and* metadata in one
response — there, `narrative` was the primary payload. Under C-401's two-call
split, call 1 already produced and streamed the authoritative narrative and call
2 receives that narrative as **input**. The shape is now metadata extraction from
already-authoritative prose, and its name no longer describes its job.

**The client already treats call 1 as authoritative.** In `_generateAiTurn`:

```ts
// The streamed narrative is authoritative — the player already read it.
const finalNarrative = narrative || parsedEnvelope.narrative || '';
```

`parsedEnvelope.narrative` is consulted **only when the streamed narrative is
falsy**, and `_parseEnvelope` already re-merges the original narrative on its
repair path. Meanwhile the extraction prompt explicitly instructs
*"Do not invent new narrative — reuse the given narrative verbatim."* — so the
model is told to spend generation budget echoing text the client already holds.

**Recommendation: option B.** Introduce a call-2-specific extraction schema
(`{ command?, choices? }`) and leave `NpcDialogueAiEnvelopeSchema` intact.

Rationale over the alternatives:

- **Not A (mutate the shared schema).** It is technically safe today because
  there is one production consumer, but the schema is exported from
  `@aikami/schemas` and its name and doc comment still describe a single-call
  contract. Silently redefining it would make the name a lie for any future
  single-call path and for the package's external contract.
- **B names the real job.** Call 2 is extraction, not authorship. A separate
  schema makes the removed requirement explicit and self-documenting, and it is
  additive — no existing consumer changes behaviour.
- **Not C (keep the field, just prompt harder).** The field is what makes the
  model generate the echo; a prompt instruction to skip it is unenforceable
  against a schema that requires it.

**One behavioural difference to state and test.** With B, the empty-stream
fallback disappears: today, if call 1 returns nothing, `parsedEnvelope.narrative`
supplies the text. After B, `finalNarrative` would be `''` in that case. This is
not a new failure mode — the existing AC-7 degrade path
(`_assembleNarrativeTurn({ narrative, … })`) already returns that same
empty-narrative turn today — and `NpcDialogueTurnSchema.narrative` is
`Type.String()` with no `minLength`, so the turn still validates. It must be
covered by a test rather than assumed.

### A concrete, measurable contributing factor

`NpcDialogueAiEnvelopeSchema` **requires** a `narrative` field, and the envelope's
prompt **is** the complete narrative from call 1. The model is therefore asked to
re-emit text the client already holds, spending scarce generation budget on
duplication — in a call whose budget is already too small. `maxTokens` for the
task is 800, against ~170 affordable.

### 🔴 A harness defect this exposed

My wire log initially reported **0 provider requests** for the envelope window,
which would have supported a comfortable "the local path is skipped" story. It was
wrong: **an aborted request fires Playwright's `requestfailed`, never
`response`**, and the capture only listened for `response`. A call that consumed
6 000 ms of real provider time was invisible.

Fixed: `requestfailed` is now recorded with its duration and no token counts
(there were none). A second defect fixed in the same pass — Ollama's **native**
surface streams as `application/x-ndjson`, not `text/event-stream`, so every
streamed local call was mislabelled non-streamed and silently lost its token
counts and phase durations.

Both are why the numbers above can be trusted and the earlier ones could not.

---

## 5. Provider call / token / cache behaviour

| | value |
|---|---|
| calls per dialogue turn | 2 (1 `dialogue` streamed, 1 `envelope` structured) |
| prompt tokens per dialogue call | 172 |
| envelope success rate | **0 / 23** |
| completion tokens per dialogue call | 162–216 |
| completion tokens per envelope call | **0 — the call never completes** |
| `tokenSource` | `provider` on completed calls; `estimated` on the aborted envelope spans |
| provider-cached prompt tokens | **unobservable on this route** |
| fallback | none recorded — the route is used as configured |

On cache telemetry: Ollama's native `/api/chat` exposes no cached-token field, so
**provider-prefix-cache behaviour is unobservable on this configuration**. That is
a property of this provider's telemetry, not a general fact about provider prompt
caching, and it remains unrelated to Aikami's own result caching and to #411's
in-flight dedup. No cloud spend was incurred to fill the gap.

---

## 6. Frame-time / resource contention

**Not collected, and honestly so.** The E2E and dev harness expose no clean
frame-time probe, and building a profiling framework to satisfy a checkbox would
be the wrong trade.

What is known without it: in §3 the burst left background calls running for tens
of seconds alongside the dialogue, and the browser stayed responsive enough to
complete the turn. That is not a frame-time measurement and is not presented as
one. **Still unknown** — and it now matters more than before, because §3 shows
background work materially delaying an interactive turn, so a rendering
consequence is plausible rather than hypothetical.

---

## 7. Deterministic behavioural regression results

Assertions added to the benchmark, all deterministic — no LLM-as-judge:

| assertion | result |
|---|---|
| each production turn satisfies `NpcDialogueTurnSchema` (via `Value.Check`) | ✅ 3/3 |
| narrative is non-empty | ✅ 3/3 |
| turn reports `source` (ai vs authored fallback) | ✅ 3/3, all `ai` |
| choice count within the schema bound (0–4) | ✅ 3/3, all 2 |
| every scenario aborts if **no** call succeeded | ✅ enforced |
| a non-conforming turn aborts the run rather than reporting latency | ✅ enforced |
| an overlapped sample with **zero** background summarization calls aborts the run | ✅ enforced, 0/10 failures in this run |
| instrumentation does not alter routing | ✅ routing recorded as `byok`/`ollama`; the seam only calls production methods |

**The gap that matters:** these assert the *turn* is well-formed. They do **not**
assert the envelope's model output, because there is none — every envelope call
is aborted. So the one behaviour most worth regression-testing (a coalesced or
recovered envelope producing a valid, correctly-validated result) remains
untested, and is listed below as the first follow-up.

### Prose-quality corpus

**Not built in this PR.** A reusable fixture boundary for player-facing prose is
the right next step, and it should be a deliberate piece of work — a fixed prompt
corpus whose outputs are compared across optimisation PRs by human review — not
something bolted onto a latency harness. Listed below.

---

## 8. #382 acceptance-criteria matrix

### Evidenced

| claim | evidence |
|---|---|
| Generation dominates player-visible dialogue latency on local hardware (96.0% of provider time) | P1 phase split, provider's own `eval_duration` |
| Client-side queueing/HTTP/parsing is not a bottleneck (~7 ms/turn) | P1 client total − provider total |
| Every `envelope` call is aborted at its 6 000 ms deadline; **0 of 23 succeed** | 23 aborted calls at 5 999–6 001 ms + client `dialogue:call-failed ms: 6002` |
| Half of every dialogue turn's client time is a discarded call; player gets fallback choices | `abortedMs` 17 998 of `clientTotalMs` 35 805; `clientOverheadMs` 18 005 |
| **A `MAP_LOADED` NPC prefetch burst raises interactive dialogue TTFT ~6.4×** | P2 A/B, 10/10 valid samples, 19 background calls counted from telemetry; TTFT median 6 353 → 40 886 ms |
| Cold cost is a one-off model load, 60% of the first request | S1 `load_duration` 4 759 ms vs warm 5 ms |
| Behavioural correctness of the returned turn holds | 3/3 `Value.Check(NpcDialogueTurnSchema)` |

### Disproven / corrected

| claim | status |
|---|---|
| "Combat already has prefetch" (#382, at `2888875f1`) | **False on current main.** No combat decision prefetch exists. Slice 6 has nothing to tune. |
| "The `MAP_LOADED` burst does not demonstrably delay interactive dialogue" (an earlier draft of this PR) | **Withdrawn — it was measuring an empty condition.** The burst was not firing; corrected methodology shows **+544% TTFT**. |
| "Compact projections are not useful local latency work" | **Scoped, not refuted.** On this measured Ollama/model/hardware dialogue workload prefill is ~1.6% of provider time, so prompt reduction is not currently demonstrated as a high-value latency lever *for this configuration*. Unmeasured for other models, hardware, long histories, larger contexts, and cloud cost. |
| "Synthetic 6-way concurrency implies a scheduler is needed" | **Wrong reasoning, right-sized problem.** Production interactive fan-out is 2, so the synthetic number was not the justification. The justification is the *measured* MAP_LOADED burst, which is real production behaviour. |

### Implemented elsewhere (unchanged by this PR)

#410 shared deadline / routing / readiness; #411 in-flight coalescing.

### Deferred

| item | reason |
|---|---|
| Envelope output-size / schema fix | **This PR is measurement-only.** The bottleneck is demonstrated; the fix is a separate PR. |
| Any contention mechanism (serialize, defer, prioritise, bound) | **Deferred until after the envelope fix.** §3 demonstrates the bottleneck but not the fix: every turn is currently floored by the 6 s failed envelope, so the experiment must be rerun at burst widths 1 / 2 / 4 before a mechanism is chosen. The bound is deliberately not pre-decided. |
| Combat measurement | Requires enabling a flag-disabled feature. |
| Provider prompt-cache telemetry | Unobservable on this route; not worth cloud spend to chart. |
| Frame-time measurement | No clean probe exists; see §6. |
| Prose-quality corpus | Deliberate separate work. |

### Implemented elsewhere (unchanged by this PR)

#410 shared deadline / routing / readiness; #411 in-flight coalescing.

### Still unknown

- Whether the burst's effect holds at higher NPC counts (1 / 2 / 4) or on
  hardware with fewer cores than this 32-thread machine. The measured effect is
  large here, but its magnitude is a property of this configuration.
- Frame time during a burst (§6).
- Whether a corrected envelope would succeed inside a reasonable budget, or
  whether its output simply does not fit one. No envelope completes, so the
  requirement is unmeasured.
- How often players actually hit a cold model load (§2).
- Cloud-provider behaviour, which inverts the prefill arithmetic.
- Long-campaign / transcript-heavy context cost.

---

## 9. Decision gate

Every opportunity observed, classified.

### 🔴 Demonstrated bottleneck #1 — the next implementation PR

**The `envelope` call is aborted at its budget on every turn.** Evidence: 0 of 23
succeeded, all aborted at 5 999–6 001 ms; client log
`dialogue:call-failed { path: turn-envelope, ms: 6002 }`; measured decode
34.8 ms/token over 74 calls; a 6 000 ms budget affords ≈170 completion tokens;
6 000 ms of provider compute discarded per turn; the player receives
deterministic fallback choices instead of model-authored ones. The call's
*requirement* is unmeasured — no envelope completes, so only capacity is known.

**Proposed next implementation PR: call-2 envelope extraction schema reduction.**

Call 2 stops being an "AI dialogue envelope" and becomes what it actually is —
metadata extraction from prose call 1 has already produced. Introduce a
call-2-specific schema and leave `NpcDialogueAiEnvelopeSchema` intact for
compatibility:

```ts
{ command?: NpcDialogueCommand, choices?: NpcDialogueChoice[] }
```

The streamed call-1 narrative remains authoritative and is **not** regenerated by
call 2. See the schema ownership audit above for why B (a new call-2 schema)
rather than mutating the shared one.

**Falsifiable before/after criteria:**

- envelope success: **0/23 → meaningful, reliable success** across the corpus;
- envelope completion tokens materially reduced;
- envelope latency materially reduced;
- overall turn latency reduced;
- the original streamed narrative remains authoritative;
- command and choice validation and preconditions unchanged;
- malformed/timeout fallback remains safe;
- no routing, deadline or privacy semantics weakened.

**If removing the narrative echo solves the problem, stop there. Do not increase
the deadline unnecessarily** — a larger budget would mask the duplication rather
than remove it, and #410's single absolute-deadline semantics must be preserved.

### 🔴 Demonstrated bottleneck #2 — fix #1 first, then re-measure

**The `MAP_LOADED` NPC prefetch burst delays interactive dialogue ~6.4×.** Evidence:
10/10 valid samples, 19 background `summarization` calls counted from client
telemetry, every sample with at least one background request still active when
dialogue began, TTFT median 6 353 → 40 886 ms, and 9 of 10 overlapped samples
slower than every quiet sample. The burst is production code on a production
event with no priority separation from interactive work.

**No mechanism is proposed here, and the concurrency bound is deliberately left
undecided.** The reason is ordering, not indecision: *every dialogue turn in this
experiment is floored by the 6 000 ms failed envelope call from bottleneck #1.*
That constant does not vary with load, so it suppresses part of the contention
signal. Fixing the envelope materially changes the experiment.

Candidate mechanisms, none yet chosen:

- serialize NPC background prefetch;
- pause or defer `summarization` while interactive inference is active;
- explicit interactive/background priority;
- bounded per-runtime concurrency;
- something simpler the architecture already supports.

**Sequence:** land the envelope fix, then rerun this measurement at burst widths
**1 NPC, 2 NPCs and 4 NPCs (the production maximum)**, counting actual
`summarization` calls rather than candidates offered, and only then choose the
smallest mechanism that protects interactive latency.

The data may well invalidate a concurrency bound chosen in advance. If a single
background summarization alongside dialogue is already severely harmful, lowering
a bound from 4 to 2 would not help and prioritisation or deferral would be the
correct design. If width 1 is acceptable and width 2+ collapses, a simple bound
suffices. The post-envelope data should decide, not this report.

### 🟡 Measured; impact or applicability unresolved

- **Context trimming for local latency.** Prefill is 1.6% of provider time on
  this configuration, so it is not currently demonstrated as a high-value
  latency lever **here**. Not generalized: unmeasured for other models, longer
  histories, larger contexts, or cloud cost.
- **Cold start.** A one-off **4 759 ms** model load — 60% of the first request.
  Large in absolute terms. **Frequency in real play is unknown**, because it
  depends on runtime `keep_alive`, idle timeout and machine sleep, none of which
  is measured here. No prewarming recommended on this evidence.

### 🔵 Unmeasurable with current instrumentation

- **Prefetch contention at other burst widths / hardware.** The effect is
  demonstrated at 2 NPCs on 32 CPU threads. Its magnitude at 1/2/4 NPCs, and on
  a machine with fewer cores, is unmeasured. Note also that total wall-clock in
  this scenario is floored by the 6 s aborted envelope, which does not vary with
  load; TTFT is the metric that carried the signal, and it is not floored.
- **Frame time during a burst.** Needs a frame-time probe that does not exist.
  Now more important than before, since background work demonstrably delays an
  interactive turn.
- **Provider prompt-prefix caching.** Unobservable on this route.

### ⚫ Incorrect assumption in #382

- "Combat already has prefetch, caching, squad-aware planning and revision
  checks." Prefetch is gone; `basedOnRevision` remains. Slice 6 is not
  measurable because there is nothing to measure.
- Implicitly, that the 6 000 ms `envelope` budget suits the hardware. It does
  not, and the failure is silent.
- Implicitly, that background `MAP_LOADED` work can share the runtime with
  interactive dialogue at equal priority. It does, and it costs the player ~6.4×
  in TTFT when it does.

---

## What this PR does not implement

No priority queue. No scheduler. No per-provider concurrency limit. No batching.
No NPC fingerprint caching. No prompt compression. No provider prompt-cache
controls. No combat prefetch. No agent wiring. No budget change. **No envelope
schema change either** — the call-2 schema reduction is proposed in §9 and is a
separate PR. **Measurement first**, as scoped.

The ordering matters: the envelope fix lands first, and the contention
measurement is rerun afterwards at burst widths 1 / 2 / 4, because the 6 s
envelope floor currently suppresses part of the contention signal.

## Reproducing

```bash
ollama pull ornith-1.5:9b
bun run herdr:start client
bun run --cwd apps/e2e bench:ai-baseline -- --label prod-path --reps 3 --sweep-samples 5
```

Flags: `--npc`, `--npc-name`, `--prefetch-npcs`, `--prefetch-names`,
`--no-production` (skips the P1/P2 production scenarios).
