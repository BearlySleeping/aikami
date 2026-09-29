---
id: C-564
title: "One critical path: shared deadlines, readiness-aware local execution, honest telemetry"
source: "issue"
contract_type: thin
status: implemented
github:
  issue_number: 382
  issue_url: "https://github.com/BearlySleeping/aikami/issues/382"
  project_item_id: null
  pr_url: null
created_at: "2026-09-29T12:00:00+02:00"
updated_at: "2026-09-29T12:00:00+02:00"
---

# C-564 — One critical path: shared deadlines, readiness-aware local execution, and honest telemetry

| Field             | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| **Status**        | implemented                                                 |
| Promotion         | —                                                           |
| Priority          | P0                                                          |
| Slice             | #382 P0 slices 1–2                                         |
| Baseline reviewed | `main` at `5af3569bf970e6552ab674f799b9be66882e0bb7`       |

---

## Problem

Three independent defects made the AI critical path slower and less honest than
it appeared to be. All three were reproduced against the review baseline.

### 1. Deadlines restarted at every layer

`text_generation_service.svelte.ts` attempted local-first structured extraction
with its own **5-second** timeout *before* routing, and only then called the
gateway, which had its own timeout. The combat decision service
(`combat_ai_service.svelte.ts`) independently enforced a **1.5 s soft** /
**4 s hard** §18 budget. A cold local load could therefore consume the whole
combat budget before the configured gateway path was ever attempted, and the
player-visible cost of a "fast" fallback was routinely several times the budget
they were waiting on.

### 2. Local execution ignored routing policy and model-specific readiness

`_tryLocalStructured` ran before any routing was resolved and never received the
caller's explicit `model` override. So:

- a caller that had deliberately pinned a model could still be served by a
  different on-device bundle — the pin was advisory, not authoritative;
- a task whose connection routed to a **cloud** provider still paid a cold local
  load first, because `localFirst` was a task-level flag with no relationship to
  the effective routing;
- the sidecar probe asked `/models` only whether a process **answered**. A
  successful probe was treated as proof the engine could generate *any* model,
  so a live engine that could not serve the routed model was still preferred.

The cooldown was a single global timestamp, so one dead local engine suppressed
*every* local route for 60 s — including a healthy alternative.

### 3. Telemetry could not distinguish measurement from guesswork

Every span reported character-count **estimates** as if they were token counts,
with no provenance field. Cost was never computed, percentiles were never
published, cache layers did not exist to be attributed, and there was no request
or turn identity — so a turn's agent calls, retries and fallbacks could not be
assembled into one traceable line. Provider-reported `usage` was discarded
entirely: the OpenAI-compatible adapter never read it.

---

## Solution

### One absolute deadline per logical request

New `ai_request_deadline.ts` provides `AiRequestDeadline`: a single absolute
instant with `windowMs(requestedMs)`, which returns the **smaller** of what a
layer wants and what is left, and `undefined` when nothing is left. Layers derive
windows instead of minting budgets, so queueing, model load, retry and fallback
all draw down the same clock.

- `text_generation_service` accepts an optional caller `deadlineAt`. A caller
  with its own budget (all three combat services) passes it, so the transport's
  clock and the request's clock are the same instant.
- With no caller deadline, the task preset's `budgetMs` applies. A task with no
  budget (`textTaskBudgetMs` → `undefined`) is deliberately **unbounded**:
  background work's deadline is the campaign, not a stopwatch.
- `stopReason()` separates `'caller-abort'` from `'deadline'` — a cancellation
  the user asked for is not a timeout to degrade from.

### Policy resolved before any spend

New `text_local_first_policy.ts` is a pure rule, unit-testable without the
singleton. A local attempt runs only when the task opted into `localFirst`,
**and** the caller pinned no explicit model, **and** the effective routing is
itself local, **and** readiness does not refute the routed model.

The routing is read from the gateway via a new `resolveText()` — the *same*
resolution `generateText` would compute, not a second implementation that could
silently disagree with the dispatch path.

New `local_readiness.ts` tracks readiness **per model**. A liveness-only probe
leaves state `unknown` (route to the gateway — the honest answer when readiness
is unproven); a served-model list that omits the routed model is a **refusal**;
a completed generation is the strongest evidence available. Cooldowns are now
keyed per route, so one dead engine never suppresses a healthy alternative.

### Honest telemetry

- **Provenance.** `AiTextUsage` carries `source: 'provider' | 'estimated'`, and
  `TextTelemetrySpan.tokenSource` carries it into the buffer and the UI. The
  OpenAI-compatible adapter now reads `usage` from streaming frames, structured
  bodies and Ollama's native `prompt_eval_count`/`eval_count`, and requests
  `stream_options.include_usage`. A body with no accounting reports **nothing**
  rather than a fabricated zero.
- **Percentiles.** p50 always; p95/p99 only at ≥ 5 samples, using nearest-rank so
  a percentile always names a real sample. Absent is not zero.
- **Versioned pricing.** `text_pricing.ts` is a small, audited table. An
  unlisted model is `source: 'unknown'` with no figure — a cost total is
  withheld entirely while any span is unpriced, because a partial sum that looks
  complete is worse than no sum.
- **Cache layers.** `TextCacheLayer` separates `in-flight-dedup`,
  `exact-result` and `provider-prompt-cache`, so a local response-cache hit is
  never reported as a provider prompt-cache saving.
- **Identity.** `requestId` / `parentRequestId` correlate one logical request
  across its local attempt, gateway call, retries and fallbacks.
- **Privacy.** Every field is content-free metadata. No prompt, no reply, no
  credential is ever buffered.

---

## Verification

| Suite | Result |
|---|---|
| `bun moon run client:test` | 4288 pass, 0 fail |
| `bun moon run constants:test` | 230 pass, 0 fail |
| `bun moon run frontend-ai-gateway:test` | 91 pass, 0 fail |
| `bun moon run client:typecheck` / `e2e:typecheck` | 0 errors |
| `bun run scripts/src/lib/ops/run_guards.ts` | 10/10 pass |
| `ai_telemetry.spec.ts` (Playwright, `--project=client`) | 8 pass |

New unit coverage pins each previously-weak behaviour: the deadline can never
open a window it cannot finish; an explicit model override is authoritative; a
cloud route is not detoured locally; readiness is per model; percentiles are
absent below the sample threshold; an unpriced model withholds the cost total;
cache hits stay attributed by layer.

The E2E lane drives a **real** call through the production
`textGenerationService` in the dev text sandbox. No provider is reachable in CI,
so the recorded call is the fallback path — the case whose failure accounting
must not be invisible. It asserts the buffer is traced, that percentiles are
absent when unmeasured, that cost stays `unknown` while unpriced, and that a
sentinel phrase typed into the prompt appears in no diagnostic row.

> The dev text sandbox gained a Diagnostics panel because that is where a
> developer issues a call and then asks where the time went. It renders
> content-free metadata only.

### Regression notes

- `combat_v2_llm.spec.ts` and one `dev_text_stream.spec.ts` case fail on this
  branch **and on `origin/main`** with the same errors (verified by stashing the
  change). They are pre-existing environment failures, not regressions: the
  local asset origin does not currently serve the Emberwatch pack manifest.
- `guard_cognitive_complexity_baseline.json` records a **reduction** (worst
  function in the OpenAI-compatible adapter 25 → 17) locked in by the sanctioned
  `--update-baseline` flow. No ceiling was raised anywhere.

---

## Rollback

Self-contained. Reverting the branch restores the previous routing, deadline and
telemetry behaviour with no schema migration, no persisted state and no
configuration change. The new modules (`ai_request_deadline`,
`local_readiness`, `text_local_first_policy`, `text_pricing`) are additive and
have no consumer outside this branch.

---

## Out of scope

Deliberately not attempted, per the issue's own guidance to stop speculative
optimization when no bottleneck is demonstrated: agent trigger/fingerprint
suppression, in-flight deduplication, exact result caching, provider
prompt-cache tuning, combat prefetch tuning, and local concurrency tuning. Each
needs its own measured baseline first.
