# Issue #382 — reproducible AI baseline (AC-1)

**Status:** measured. Covers the latency/call-count/token half of AC-1. The
narrative-quality half is **not** covered — see [What this report does not
claim](#what-this-report-does-not-claim).

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
| Repetitions | 4 (sequential scenarios), 3 per point (context sweep), batch 6 |

> 🔴 The client does **not** use the OpenAI-compatible surface. The `ollama`
> registry entry routes to Ollama's native `/api/chat`, whose response has
> `prompt_eval_count`/`eval_count` and **no `usage` block and no cached-token
> field**. A harness that only understood `usage` reports zero tokens for every
> call and looks like it measured token cost. Provider-side prefix-cache hits are
> **unobservable on this route** and are reported as such, never as `0`.

---

## Result: identical concurrent structured calls

Six byte-identical `extractStructure` calls — the production surface behind the
game's `envelope` task — fired at the same instant.

| | baseline `2888875f1` | `main` `ce5a1db58` | change |
|---|---|---|---|
| **provider HTTP requests** | **6** | **1** | **−83%** |
| client wall clock | 17 327 ms | 2 338 ms | **−87%** |
| per-request p95 | 17 323 ms | 2 334 ms | −87% |
| prompt tokens | 1 212 | 202 | −83% |
| completion tokens | 507 | 69 | −86% |
| **calls that succeeded** | **6 / 6** | **6 / 6** | unchanged |
| spans marked `in-flight-dedup` | 0 | 5 | — |
| failed requests | 0 | 0 | unchanged |

Every caller still receives a parsed result. The work is collapsed, not dropped —
which is the distinction #411 was built around, since a *result* cache would
have under-reported real spend and a dropped subscriber would have failed the
batch.

This is the #411 in-flight coalescer doing exactly what it claims, measured
from outside the client: six requests became one, and the token bill fell in
proportion.

**The two sources agree.** The client recorded 5 of its 6 spans as
`cacheLayer: 'in-flight-dedup'` with `tokenSource: 'estimated'` — correctly
*not* charged, since a coalesced subscriber's tokens were paid for by the span
that actually went to the provider. The wire independently recorded 1 request.
Two independent measurements of the same event, no reconciliation needed.

> A caveat on the instrument, since it changed the number: an earlier revision of
> the seam read the telemetry buffer with `slice(before)`. The buffer is
> **newest-first** (`[entry, ...spans]`), so that sliced the wrong end and
> reported `coalescedSpans: 0` on a run that coalesced all five. The figure above
> is from the corrected read. The wire count was never affected — which is the
> reason the harness does not trust the client's own accounting.

---

## Control: the scenarios that should NOT have changed

These are the noise floor for this hardware. If they had moved as much as S4,
the S4 number would be suspect.

| Scenario | baseline median | `main` median | reading |
|---|---|---|---|
| S1 cold start (model evicted) | 6 568 ms | 5 694 ms | within noise |
| S2 warm sequential ×4 | 2 556 ms | 3 307 ms | within noise |
| S3 context sweep (12 calls, 9 993 prompt tokens both sides) | 3 605 ms | 3 264 ms | **within noise, identical tokens** |
| S5 distinct concurrent ×6 | 13 738 ms | 9 289 ms | within noise |

S3 is the strongest control: identical request count, identical token totals,
medians 341 ms apart against a ±1 s noise band. The harness is measuring the
same work on both sides.

**Noise band.** Run-to-run variance on this 9B CPU model is roughly ±1 s, which
is comparable to a whole warm call — and it is visible *within* a single
scenario, where the baseline's own S4 p95 is 1.8× its median. Across repeated
runs of this harness the same scenario moved by up to 2.5 s, which is why S1,
S2 and S5 are **not** read as improvements or regressions. Only S4 is claimed as
a result, and it clears the band by 7×.

---

## Finding: context length is not the local latency bottleneck

S3 grows the prompt ~10× while holding everything else constant:

| prompt repeats | prompt tokens/call | baseline median | `main` median |
|---|---|---|---|
| 1 | 205 | 2 828 ms | 2 049 ms |
| 4 | 298 | 3 603 ms | 2 722 ms |
| 16 | 670 | 3 730 ms | 3 432 ms |
| 64 | 2 158 | 5 043 ms | 4 678 ms |

Prompt tokens rise 10.5× (205 → 2 158) and latency does not track it. Completion
tokens stay flat at ~90–100 per call across the whole sweep, and they — not
prefill — are what the time is spent on. Going from 205 to 2 158 prompt tokens
costs roughly 1.3× the time; going from 1 to 4 repeats costs nothing measurable.

**This is a negative result with a scope.** It argues against spending effort on
prompt compression, compact projections and transcript trimming *as a local
latency lever* — the issue lists those under P1. It does **not** speak to
**cloud** providers, where input tokens are billed per token and the arithmetic
inverts completely. On local hardware, token count is a cost story, not a
latency story.

---

## Finding: more local concurrency is not faster

S5 fires six *different* calls concurrently — 6 provider requests, no collapsing
available. Per-request medians land in the 9.3–13.7 s range against 2.5–3.3 s
for the same calls issued sequentially, and the batch p95 reaches ~21 s.

Six requests in parallel cost roughly 3–4× more wall-clock than six in series on
this CPU-only box. The issue's warning — *"measure throughput under concurrency
rather than assuming more parallel requests are faster"* — is confirmed, and it
has a direct consequence: **any future local-concurrency or priority-queue work
(P1 slice 4) should be sized against this, not against a request count.**

This also explains S4. Six *identical* requests at baseline (S4) cost 17.3 s of
wall clock; six *distinct* requests (S5) cost 13.7 s. The identical batch was
*slower* than the distinct one — six copies of the same prefill competing for
the same cores. Collapsing the duplicates removed work that was never going to
get faster by running in parallel.

---

## Finding: the eight built-in agents never run in a shipping build

Full detail in [`docs/audits/agent-trigger-usage.md`](../audits/agent-trigger-usage.md).

Short version: `chat_composition.ts` — the production capability set — does not
supply `agentPipelineViewModel`, so the branch that runs the agents is never
taken, and the only construction site for the pipeline ViewModel is a `(dev)`
route that production builds strip entirely.

The issue's P1 slice 3 ("event-based invocation rules for each agent",
"fingerprint suppression for repeated generic post-processing", "opt-in prose
review") therefore has **no target**. Those changes are premised on agents
running every turn and wasting calls. They do not run, so there are no redundant
calls to remove. Building the suppression logic would have been optimizing
nothing.

The real production AI surface is `dialogue` (one streamed call) plus `envelope`
(one structured call) per turn, plus combat calls.

---

## What this report does not claim

Stated plainly, because AC-1 asks for narrative/gameplay quality and this report
does not deliver it.

- **Narrative and gameplay quality are unmeasured.** S1–S5 all request the same
  two-field envelope from a deliberately repetitive synthetic scene. Nothing here
  compares prose, and the harness makes no attempt to. AC-1's quality clause
  needs a scored narrative comparison (the same prompt set through both commits,
  blind-rated), which is a separate piece of work and is not started.
- **One model, one machine, CPU-only.** No GPU, no cloud provider, no small
  hosted model. Findings about local prefill do not transfer to a billed API.
- **Small sample.** 4 repetitions on the sequential scenarios, 3 per context
  point, 1 batch on the concurrent ones. Enough to establish S4; not enough to
  resolve the differences in S1/S2/S5, which is exactly why they are reported as
  noise.
- **S2 reads worse on `main`** (2 556 → 3 307 ms). With S3 as a control on
  identical token totals and a ±1 s noise band, this is variance, not a
  regression. It is reported here so the raw number is not quietly dropped.
- **The client-side coalescing figure was wrong on the first run** and was fixed.
  The wire count was correct throughout. See the caveat under the S4 table.
- **The envelope call was not exercised through combat or dialogue.** The
  scenarios drive `extractStructure` directly, so turn-level interaction cost —
  request assembly, macro parsing, engine application — is not included.
- **Provider prompt caching is untested.** It cannot be, on this route: the
  native Ollama response carries no cached-token field.

---

## Reproducing

```bash
# 1. A text provider. Default is a local Ollama on :11434.
ollama pull ornith-1.5:9b

# 2. The client.
bun run herdr:start client

# 3. The baseline.
bun run --cwd apps/e2e bench:ai-baseline -- --label baseline-2888875f1 --reps 4
```

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
