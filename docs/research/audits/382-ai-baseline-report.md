# Issue #382 — reproducible AI baseline (AC-1)

**Status:** measured. This is **one benchmark, not the AC-1 deliverable.** It
covers the call-count, token and coalescing half of AC-1 for a single synthetic
structured-extraction workload. It is **not** representative coverage: no
dialogue, no combat, no long-campaign transcript, no background-agent load, no
quality assessment, and no phase breakdown of where a turn's time goes.

What it establishes is that the harness is sound and that one real behaviour
changed. What it deliberately does not establish is what to optimize next —
that needs the coverage listed in
[AC-1 status](#ac-1-status--what-is-and-is-not-evidenced).

**Issue:** [#382](https://github.com/BearlySleeping/aikami/issues/382)
**Before:** `2888875f1` (the issue's own review baseline)
**After:** `ce5a1db58` (#410 P0 + #411 P1 merged)
**Harness:** `apps/e2e/scripts/ai_baseline_bench.ts` → `bun run --cwd apps/e2e bench:ai-baseline`
**Raw runs:** `.evidence/382-baseline/{baseline-2888875f1,main-ce5a1db58}/report.{md,json}`

---

## Why the harness measures at the wire

The obvious place to read AI timings is the client's own telemetry buffer. That
cannot support a before/after here: `getTextTelemetry` was added by #410, so the
baseline checkout has nothing to read. A client-side-only measurement could only
ever be compared against itself.

So the primary measurement is **commit-agnostic**: every HTTP request the
browser makes to the provider, with wall-clock duration and the provider's own
token accounting. That is observable from outside at *any* commit. The client
telemetry buffer is read as a secondary source and is explicitly allowed to be
absent — on the baseline run it is.

Both counts are recorded for the same work, so a disagreement between what the
client thinks it did and what went on the wire is visible rather than averaged
away.

---

## Environment

Identical for both runs.

| | |
|---|---|
| CPU | Intel Core i9-14900HX, 32 cores |
| RAM | 31.1 GB |
| GPU | none detected — **CPU-only inference** |
| Runtime | Ollama 0.34.3, native `/api/chat` |
| Model | `ornith-1.5:9b` — 9.0B, Q4_K_M, 6.6 GB on disk, ctx 262144 |
| Repetitions | 4 (sequential), 7 per context point, batch 6 |

> 🔴 The client does **not** use the OpenAI-compatible surface. The `ollama`
> registry entry routes to Ollama's native `/api/chat`, whose response has
> `prompt_eval_count`/`eval_count` and **no `usage` block and no cached-token
> field**. A harness that only understood `usage` reports zero tokens for every
> call and looks like it measured token cost. Provider-prefix-cache behaviour is
> **unobservable on this Ollama route** — a property of this provider's
> telemetry, not of provider prompt caching in general — and is reported as
> unobservable, never as `0`.

---

## ⚠️ What this measurement is evidence OF

Read the provenance before the number.

**The 6 → 1 request reduction is evidence for #411, which is already merged. This
PR did not cause it and does not claim credit for it.** #412 is a measurement and
audit change: it adds a harness, a test-seam probe and two documents. It changes
no routing, no deadline and no request logic.

What #412 contributes is the *ability to verify* #411's central claim from
outside the client — that identical concurrent requests collapse without dropping
a subscriber — against the issue's own review baseline rather than against
itself. If the harness had only ever run on `main`, the number would be
unfalsifiable.

---

## Result: identical concurrent structured calls

Six byte-identical `extractStructure` calls — the production surface behind the
game's `envelope` task — fired at the same instant.

| | baseline `2888875f1` | `main` `ce5a1db58` | change |
|---|---|---|---|
| **provider HTTP requests** | **6** | **1** | **−83%** |
| client wall clock | 20 924 ms | 3 329 ms | **−84%** |
| per-request p95 | 20 918 ms | 3 327 ms | −84% |
| prompt tokens | 1 212 | 202 | −83% |
| completion tokens | 588 | 92 | −84% |
| **calls that succeeded** | **6 / 6** | **6 / 6** | unchanged |
| spans marked `in-flight-dedup` | 0 | 5 | — |
| failed requests | 0 | 0 | unchanged |

Every caller still received a result. The work is collapsed, not dropped — the
distinction #411 was built around, since a *result* cache would have
under-reported real spend and a dropped subscriber would have failed the batch.

This is #411's in-flight coalescer doing what it claims, measured from outside
the client: six requests became one, and the token bill fell in proportion.

**Caveat on "received a result":** the harness records that all six calls
resolved; it does not assert the parsed values were well-formed. Coalesced
subscribers receiving a malformed payload would pass every check in this report.
That gap is listed above and is the first thing the next benchmark should close.

**The two sources agree.** The client recorded 5 of its 6 spans as
`cacheLayer: 'in-flight-dedup'` with `tokenSource: 'estimated'` — correctly
*not* charged, since a coalesced subscriber's tokens were paid for by the span
that actually went to the provider. The wire independently recorded 1 request.
Two independent measurements of the same event, no reconciliation needed.

> **Two instrument defects had to be fixed before this figure was trustworthy.**
> Both produced confident, wrong numbers, and both are recorded rather than
> quietly corrected, because that is the failure mode worth learning from:
>
> 1. The first revision read the telemetry buffer with `slice(before)`. The
>    buffer is **newest-first** (`[entry, ...spans]`), so that sliced the wrong
>    end and reported `coalescedSpans: 0` on a run that coalesced all five.
> 2. The fix for (1) used a **length** delta, which reads as zero once the
>    100-entry cap is reached and the length stops moving. It now tracks the
>    monotonic span `id`, which is correct whether the buffer is empty, partly
>    full or saturated.
>
> The **wire count was correct throughout** — which is the reason the harness
> records an independent wire measurement and does not rely on the client's own
> accounting.

---

## Control: the scenarios that should NOT have changed

These are the noise floor for this hardware. If they had moved as much as S4,
the S4 number would be suspect.

| Scenario | baseline median (min–max) | `main` median (min–max) | reading |
|---|---|---|---|
| S1 cold start (model evicted) | 6 742 ms (n=1) | 7 873 ms (n=1) | single sample; direction is not a result |
| S2 warm sequential ×4 | 2 438 ms (2 122–3 556) | 3 596 ms (3 302–3 935) | within noise |
| S3 context sweep (28 calls, 23 317 prompt tokens both sides) | 3 831 ms | 3 855 ms | **within noise, identical tokens** |
| S5 distinct concurrent ×6 | 9 168 ms (2 711–21 616) | 8 762 ms (2 287–22 642) | within noise |

Each scenario now **aborts the run if no call in it succeeded**, so a routing
regression, an unreachable provider or a missing model cannot produce a row of
confident zeros. `medianMs` is `null` rather than `0` when nothing was observed,
so "not measured" never renders as "instant".

S3 is the load-bearing control: identical request count, **identical token
totals on both commits** (23 317 prompt tokens), medians 24 ms apart. The harness
is demonstrably measuring the same work on both sides, which is what licenses
reading S4 as signal.

**Noise band.** Run-to-run variance on this 9B CPU model is roughly ±1 s, which
is comparable to a whole warm call — and it is visible *within* a single
scenario, where the baseline's own S4 p95 is 1.8× its median. Across repeated
runs of this harness the same scenario moved by up to 2.5 s, which is why S1,
S2 and S5 are **not** read as improvements or regressions. Only S4 is claimed as
a result, and it clears the band by 7×.

---

## Finding: the prefill cost of short prompts is below the noise floor

S3 grows the prompt ~10× while holding everything else constant:

| prompt repeats | prompt tokens/call | baseline median | `main` median |
|---|---|---|---|
| 1 | 205 | 2 828 ms | 2 049 ms |
| 4 | 298 | 3 603 ms | 2 722 ms |
| 16 | 670 | 3 730 ms | 3 432 ms |
| 64 | 2 158 | 5 043 ms | 4 678 ms |

Prompt tokens rise 10.5× (205 → 2 158). What latency does is **not resolvable at
this sample size** — 7 samples per point, with min/max shown:

| prompt repeats | prompt tok/call | baseline median (min–max) | `main` median (min–max) |
|---|---|---|---|
| 1 | 205 | 3 831 ms (1 981–4 303) | 3 865 ms (2 389–4 695) |
| 4 | 298 | 3 828 ms (2 500–4 391) | 2 580 ms (2 263–3 855) |
| 16 | 670 | 2 940 ms (2 644–4 493) | 2 954 ms (2 552–4 629) |
| 64 | 2 158 | 4 773 ms (3 599–6 087) | 4 162 ms (3 916–4 991) |

Endpoint-to-endpoint ratio: **1.25× on baseline, 1.08× on `main`** for 10.5× the
prompt tokens. **The observed ranges overlap at every end**, and the curve is
non-monotonic in the middle on both commits.

### Two corrections to earlier drafts of this report

This section previously claimed prefill was flat ("latency does not track prompt
size", ~1.3×). An intermediate draft, with only 3 samples per point, produced
1.78× and 2.28× from the same table. **All three numbers are reported here
because none of them is stable**, and the reason is visible in the min/max
columns: run-to-run spread on this box is ±1 s, which is the same order as the
effect being measured.

**Conclusion: on this hardware, at this prompt scale (205–2 158 tokens), with
this workload, the prefill cost is not distinguishable from noise.** That is a
statement about *this measurement's power*, not proof that prefill is free. It
means the benchmark as designed cannot answer the question.

### What would actually answer it

- Many more samples per point (this is CPU-bound; each call is seconds).
- A **wider** prompt range. 2 158 tokens is a short prompt; the interesting
  regime is 8k–32k, where prefill can become superlinear and KV memory starts
  to matter. The current sweep stops well short of where the effect would show.
- Holding **output** tokens fixed while varying input — this sweep does that
  (completion stays ~80–107), which is the right design and should be kept.
- A **longer-context workload** that actually carries a transcript, since real
  dialogue and combat turns do.

### Scoped claims this measurement does support

- Completion generation dominates **this** short structured microtask: output is
  ~80–107 tokens regardless of a 10.5× input range, and the time is roughly flat
  in that input range.
- Nothing about **cloud** input-token cost, where input tokens are billed per
  token and the arithmetic inverts.
- Nothing about **memory / KV pressure**, which grows with context even when
  measured latency does not.
- Nothing about **long-context** workloads, and nothing about other microtasks.

**Net effect on #382:** the "compact projections / transcript trimming" items stay
**unresolved rather than refuted**. They are not shown to be worthless; they are
shown to be unmeasurable by this benchmark. Whether they matter locally remains
an open question that a wider-range, longer-context benchmark could settle — and
that is now a concrete, well-specified candidate for the next PR.

---

## Finding: more local concurrency is not faster

S5 fires six *different* calls concurrently — 6 provider requests, no collapsing
available. Medians land at 9 168 ms (baseline) and 8 762 ms (`main`) against
2 438–3 596 ms for the same calls issued sequentially.

**But the spread is enormous**: individual calls range from **2 287 ms to
22 642 ms** within a single S5 batch. The min/max columns in the control table
above show the same thing. This is contention, and it is highly variable.

Six requests in parallel cost roughly 3–4× the sequential wall clock on this
CPU-only box, consistent with the issue's warning — *"measure throughput under
concurrency rather than assuming more parallel requests are faster."*

This also explains S4. Six *identical* requests at baseline cost 20.9 s of wall
clock; six *distinct* requests cost 17.6 s. The identical batch was **slower**
than the distinct one — six copies of the same prefill competing for the same
cores. Collapsing the duplicates removed work that was never going to get faster
by running in parallel.

### 🔴 This does NOT yet justify a scheduler

The finding is about *synthetic* 6-way concurrency, and one question must be
answered before it can drive P1 slice 4: **can current production actually create
this contention?**

A dialogue turn issues one `dialogue` call and one `envelope` call. That is 2,
not 6. The eight agents that could have produced a fan-out are not wired
([audit](agent-trigger-usage.md) — experimental by design). So the
measured 6-way contention may have **no production analogue at all**, and
building bounded concurrency or priority queues to fix it would be optimizing a
workload that does not occur.

What is needed is a measurement of **real** fan-out on the real surfaces: how
many model calls a dialogue turn, a combat exchange and a long campaign session
issue, and whether any of them overlap. Until that exists, "concurrency is slow"
is a fact about the benchmark, not about the game. That measurement is the first
item of the proposed next PR.

---

## Finding: the agent pipeline is experimental and never was player-facing

Full detail in [`docs/audits/agent-trigger-usage.md`](agent-trigger-usage.md).

`chat_composition.ts` — the production capability set — does not supply
`agentPipelineViewModel`, so the branch that runs the agents is never taken. The
pipeline's only construction site is a `(dev)` route that production builds
strip.

**Why that matters was worth establishing rather than assuming.** The three
candidate explanations lead to opposite follow-ups, and the evidence rules out
two of them:

| | Verdict | Evidence |
|---|---|---|
| C — accidental regression | **ruled out** | `chat_composition.ts` has never contained the wiring, in *any* revision. Nothing was severed later. |
| B — unfinished feature | **ruled out** | C-236 scoped a dev sandbox as in-scope and scored it AC-6; the contract is `completed` with all ACs done. The parameter was introduced **already optional** in the original commit. |
| **A — intentional, experimental** | **confirmed** | Contract scope + AC-6 + optional-from-birth + no E2E/visual test asserts pipeline behaviour on any game route. |

So the issue's P1 slice 3 ("event-based invocation rules for each agent",
"fingerprint suppression for repeated generic post-processing", "opt-in prose
review") has **no target today** — those changes are premised on agents running
every turn in a shipping build, and by design they have not since C-236 landed.

**This is not a licence to wire the agents in.** Enabling an experimental
subsystem for players is a feature decision with narrative, cost and privacy
consequences, not a performance one, and it belongs to whoever owns it. If the
pipeline is later promoted, the trigger work should be designed *then* against
real traffic.

The one thing worth fixing is cosmetic: the dormant hooks look like a live
integration. `agentPipelineViewModel?` on the production chat ViewModel plus a
production composition exporting a real factory reads as "this works". Marking it
explicitly experimental at the seam is a small separate PR.

The real production AI surface is `dialogue` (one streamed call) plus `envelope`
(one structured call) per turn, plus combat calls.

---

## AC-1 status — what is and is not evidenced

The full acceptance criteria of #382, not just AC-1, since this report is offered
as evidence for the programme.

### Evidenced

| Claim | Evidence |
|---|---|
| Identical concurrent structured requests collapse from N to 1 provider request, with every subscriber still receiving a result | S4: 6→1 requests, 6/6 succeeded, wire and client telemetry agree |
| The token bill falls in proportion when work is collapsed | S4: 1 212→202 prompt tokens, 588→92 completion |
| In-flight dedup is correctly **not charged** for coalesced subscribers | 5 spans at `tokenSource: 'estimated'`, `cacheLayer: 'in-flight-dedup'` |
| The wire is a sound, commit-agnostic measurement surface | Baseline (no `getTextTelemetry`) and `main` both measured identically |
| Synthetic local concurrency is a net loss, with high variance | S5: 2 287–22 642 ms per call vs 2 438–3 596 ms sequential |
| The agent pipeline has never been player-facing, by design | Git history across all revisions + C-236 contract scope/ACs |
| Cold start costs roughly 2–3× a warm call on this box | S1 (6 742 / 7 873 ms) vs S2 (2 438 / 3 596 ms), single-sample S1 |

### Disproven

| Claim | Status |
|---|---|
| *Withdrawn claim:* "compact projections / transcript trimming are not useful local latency work" | **Not disproven — but also not supported.** An earlier draft of this report asserted it. The powered run could not resolve the effect (1.25× / 1.08×, overlapping ranges). Now **unresolved**, not refuted. |
| "Provider prompt caching cannot be measured" | **Disproven as stated.** It is unobservable *on the Ollama native route*; providers that expose cache usage do report it. Corrected in the harness and report. |

### Implemented (by merged work, not by this PR)

- #410 — shared deadline per logical request, policy-resolved-before-spend routing, model-specific local readiness, per-route cooldowns, honest telemetry.
- #411 — reference-counted in-flight coalescing. **This PR supplies the external evidence for its central claim**, which was previously only self-attested.

### Deferred with reasons

| Item | Reason |
|---|---|
| Agent trigger rules / fingerprint suppression (P1 slice 3) | No target: the pipeline is experimental and unwired. Not a licence to wire it. |
| Priority queues / bounded local concurrency (P1 slice 4) | Contention measured synthetically, but production fan-out is unknown. Needs the real-traffic measurement first. |
| Exact-result caching, provider prompt-prefix caching | Need separate correctness design (state fingerprinting, content-pack versioning) per the issue's own constraints. |
| Combat prefetch tuning (slice 6) | Not measured at all here. |

### Still unknown

Where player-visible latency actually goes. #382 asks to *"trace user action →
routing → queue → load → prompt assembly → network/prefill → first token →
completion → parsing/validation → application of result"*. **None of those phases
are individually instrumented here** — the harness measures end-to-end HTTP only.
So the following remain open, and they are what the next PR should target:

- how many model calls a real dialogue turn, combat exchange and long campaign
  session issue, and whether they overlap;
- where a turn's time is spent across queue / load / prefill / generation /
  parse / apply;
- how much of that is queueing behind background work;
- whether dialogue, envelope and combat outputs are still **behaviourally
  correct** — this report asserts calls resolved, not that they parsed and applied
  correctly;
- narrative and gameplay quality.

---

## What this report does not claim

AC-1 is broader than this benchmark. Listed by what the issue asked for:

| #382 asks for | Status here |
|---|---|
| dialogue workload | **not covered** — only `extractStructure` is driven |
| combat workload | **not covered** |
| long-campaign / context-heavy | **not covered** — max 2 158 prompt tokens |
| cold start | covered (S1), single sample |
| concurrent local inference | covered (S4/S5), synthetic 6-way |
| background-agent workload | **n/a** — agents are not wired (audit) |
| p50/p95 where meaningful | **only S4**; other scenarios have too few samples |
| queue / load / prefill / generate / parse / apply breakdown | **not covered** — no phase instrumentation |
| cold vs warm | partial — S1 vs S2, S1 is single-sample |
| gameplay/rendering contention | **not covered** |
| behavioural correctness of outputs | **not covered** — no assertion on parsed content |
| narrative / gameplay quality | **not covered** — see below |

Other limits, stated plainly:

- **Narrative and gameplay quality are unmeasured.** S1–S5 all request the same
  two-field envelope from a deliberately repetitive synthetic scene. Nothing here
  compares prose. For this, the preference is **deterministic regression
  fixtures and invariants** — schema conformance, macro round-tripping, state
  application — over an LLM-as-judge score, and a small human-inspection corpus
  for prose where judgment is genuinely required. An invented judge score would
  be worse than an honest gap.
- **Behavioural correctness is unasserted.** The harness records that 6/6 calls
  resolved; it does **not** check the parsed values were well-formed or applied
  correctly. A coalesced subscriber receiving a malformed result would pass every
  check here. This is the most important gap to close, because #411's
  correctness claim is exactly about what coalesced subscribers receive.
- **One model, one machine, CPU-only.** No GPU, no cloud provider. Local prefill
  findings do not transfer to a billed API.
- **Small sample.** 4 repetitions sequential, 7 per context point, 1 batch on
  concurrent. Enough for S4; not enough to resolve S1/S2/S5, which is why they
  are reported as noise rather than as results.
- **S2 reads worse on `main`** (2 438 → 3 596 ms). With S3 as a control on
  identical token totals and heavily overlapping min/max ranges, this is variance,
  not a regression. Reported so the raw number is not quietly dropped.
- **Three harness defects were found and fixed** — the newest-first buffer, a
  length-delta that breaks at the 100-span cap, and a `usage`-only token parser.
  The wire count was correct throughout. See the note under the S4 table and the
  environment note.
- **The envelope call is not exercised through combat or dialogue.** Turn-level
  cost — request assembly, macro parsing, engine application — is excluded.
- **Provider prefix-cache behaviour is unobservable on this route.** The native
  Ollama response carries no cached-token field. That is a statement about *this
  provider's telemetry*, not about provider prompt caching in general: it is
  well-defined and measurable on providers that expose cache usage, and would be
  worth benchmarking there — though not by spending cloud credits to complete a
  chart. Provider KV/prefix caching is also a different mechanism from Aikami's
  own result caching and from the in-flight dedup in #411; this benchmark says
  nothing about the latter two beyond the dedup request count.

---

## Reproducing

```bash
# 1. A text provider. Default is a local Ollama on :11434.
ollama pull ornith-1.5:9b

# 2. The client.
bun run herdr:start client

# 3. Run it. `--sweep-samples 7` is what the numbers above were produced with;
#    the default is 7. Raise it for tighter medians at the cost of runtime.
bun run --cwd apps/e2e bench:ai-baseline -- --label main-ce5a1db58 --reps 4 --sweep-samples 7
```

Useful flags: `--model`, `--endpoint`, `--batch`, `--label`, `--skip-cold`.

The harness needs three things from the client, all on the test seam:

1. **`benchmarkIdenticalStructuredBatch`** — issues N identical `extractStructure`
   calls and reports what the client observed. Present in
   `game_test_seam_text_probes.ts`. It is measurement apparatus, not product
   code, and it calls the production `extractStructure`, so it measures each
   commit's own logic. **Copy it onto the baseline** to reproduce the *before*
   number; the harness's own file is unchanged across both runs.
2. **`loadTextProviderConfig`** — present on the baseline only, and only because
   of a real asymmetry: at `2888875f1` nothing on the game route calls
   `configService.load()`, so a written vault never becomes resolvable
   connections and every call fails with *"No text generation provider
   configured."* Current `main` loads config during app init. Without this call
   the comparison would measure the two commits' **boot wiring** rather than
   their **AI request path**. The harness calls it optionally, so one file runs
   on both sides.
3. **`getTextTelemetry`** — `#410` only. Absent on the baseline, and the report
   records its absence rather than treating the gap as a zero.

The harness writes the provider connection itself: a v3 config vault encrypted
through the browser's own Web Crypto using the same PBKDF2/AES-GCM parameters the
client uses, with the per-origin secret in `localStorage`. It reads no key and
bypasses no boundary.

Results land in `.evidence/382-baseline/<label>/` as `report.md` and
`report.json` (including every individual wire call).
