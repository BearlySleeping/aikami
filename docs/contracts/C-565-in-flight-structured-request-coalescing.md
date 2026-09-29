---
id: C-565
title: "In-flight coalescing of identical structured requests"
source: "issue"
contract_type: thin
status: implemented
github:
  issue_number: 382
  issue_url: "https://github.com/BearlySleeping/aikami/issues/382"
  project_item_id: null
  pr_url: null
created_at: "2026-09-29T18:00:00+02:00"
updated_at: "2026-09-29T18:00:00+02:00"
---

# C-565 — In-flight coalescing of identical structured requests

| Field             | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| **Status**        | implemented                                                  |
| Promotion         | —                                                            |
| Priority          | P1                                                           |
| Slice             | #382 P1 "In-flight deduplication"                            |
| Depends on        | C-564 (shared deadlines, task-preset budgets, routing policy) |
| Baseline reviewed | `main` at `5af3569bf970e6552ab674f799b9be66882e0bb7`        |

---

## Problem

The same structured micro-task is frequently issued more than once before any
of them finishes — a double-tapped dialogue chip, a panel that mounts twice,
two post-agents that happen to share a prompt. Each issued its own provider call
for a byte-identical request: N real calls, N spends against one latency budget,
and a provider asked the same question N times.

C-564 made this measurable but not fixed. It supplied the request/turn identity
needed to see the duplicates; this contract removes them.

The reason naive deduplication is not safe to ship is cancellation. If the first
caller to arrive owns the shared call, then that caller cancelling — or navigating
away, or a deadline firing for it — kills the work every other caller is still
waiting for. A deduplicator that gets this wrong trades duplicate calls for
*lost* calls, which is strictly worse.

---

## Solution

### Reference-counted, with a strictly last-subscriber teardown

`structured_request_deduplicator.ts` is a pure primitive: it owns an attempt and
a subscriber count, nothing else.

- Cancelling **one** consumer detaches **that consumer** and resolves it as
  `cancelled`. The shared call is untouched.
- The shared call is aborted only when its **last** subscriber releases it —
  because at that point nobody can consume the answer, and leaving a provider
  call running unobserved is its own failure mode.
- A **settled** attempt is never aborted afterwards. Its work is done, and
  flipping its signal would misreport a completed call as cancelled to anything
  still holding that signal.
- `cancelAll` (used on dispose) detaches every waiter first, so no consumer is
  left awaiting a promise nothing will fulfil, then aborts.

### The caller's own error survives

Every subscriber receives the attempt's **original** error, not a substituted
one. A caller that must tell a timeout from a cancellation from a provider
refusal still can: those three take different paths in every consumer here. A
cancelled caller is rejected with **its own** abort reason rather than a
synthesised `AbortError` that would drop it.

### Two layers, deliberately

`structured_request_deduplicator.ts` is the primitive: an attempt and a
subscriber count, nothing else. `structured_call_coalescer.ts` is the layer
around it, owning the three things the primitive should not know about — request
identity (including the schema fingerprint), the shared work's deadline, and
error identity. Both are pure and separately testable; the split exists so the
cancellation rules are provable without a service, a gateway or a clock.

### Request identity cannot be forged

The key is length-prefixed (`len:value` per field). Plain concatenation would
make `("ab", "c")` and `("a", "bc")` the same key, and one request's prompt
would then be served another request's answer. The schema fingerprint
participates because the same prompt under a different schema is a different
question.

The key builder is module-private on purpose: a caller that built its own key
string would have to re-derive these rules, and a divergence would silently
merge requests that must stay apart.

### Deliberately NOT a result cache

Only *simultaneously in flight* calls merge. An entry is dropped the moment its
attempt settles, so the next identical call goes to the provider again. This is
asserted, not merely intended: a result cache needs state fingerprinting,
content-pack versioning and campaign scope — three correctness requirements
this change does not take on, and smuggling them in would be the exact
"semantic approximate-result caching for state-changing gameplay" the issue
rules out without a separate design.

---

## Why the shared call gets its own deadline

This was the one non-obvious correctness requirement, and it is called out in
the code because getting it wrong is invisible until it bites.

A coalesced attempt is shared work, so it must not inherit any single
subscriber's cancellation. The initiating subscriber's deadline is derived from
*its* `signal`; reusing it for the shared call would mean that subscriber
leaving cancels the work everyone else is waiting on — reintroducing, inside the
deduplicator's own caller, the exact failure the reference counting exists to
prevent.

The shared attempt keeps the initiator's **absolute deadline**, including time
already spent locally, using an independent signal. An unbounded initiator
leaves the shared attempt unbounded. Each consumer's abort or deadline detaches
that consumer; deadline detachment reports a timeout. The shared deadline is
disposed when the attempt settles.

---

## Verification

| Suite | Result |
|---|---|
| `bun moon run client:test` | 4328 pass, 0 fail |
| `bun moon run client:typecheck` | 0 errors |
| `bun run scripts/src/lib/ops/run_guards.ts` | 10/10 pass |
| `ai_telemetry.spec.ts` (Playwright, `--project=client`) | 10 pass |

Unit coverage is split to match the two layers. The primitive covers the
cancellation rules; the coalescer covers identity, the shared clock, and error
identity. Between them they pin each property that made naive deduplication
unsafe:

- two identical concurrent requests make **one** call; twelve make one;
- a different prompt, or the same prompt under a different schema, is **not**
  merged;
- cancelling one consumer leaves the other **served**, and the shared call
  **unaborted**;
- cancelling the **last** consumer aborts the shared call;
- a settled request is **not** replayed — coalescing only, never caching;
- a failure reaches every consumer and is **not** remembered as a success;
- a settled attempt is not aborted by a late teardown;
- `cancelAll` detaches every waiter and resolves them rather than hanging.

Integration coverage in `text_generation_service.test.ts` drives the real
service: the same request twice concurrently is one gateway call; a cancelled
consumer does not disturb its survivor; and a request issued *after* a settled
one is not replayed.

The E2E lane asserts the observable consequence: a repeated **sequential** call
is counted twice, because a result cache would have under-reported real spend.

### Structural notes

`text_generation_service.svelte.ts` was already near the 800-line hard limit,
and the coalescing work pushed it past. Two cohesive responsibilities were
extracted rather than the module being split arbitrarily: the local attempt with
its per-route cooldown (`local_first_execution.ts`), and the coalescing layer
(`structured_call_coalescer.ts` over `structured_request_deduplicator.ts`). The
service is left as the routing and deadline decision surface it should be.

No guard baseline was raised. The pre-existing cognitive-complexity baseline
entry for the OpenAI-compatible adapter was already locked in by C-564; the
`spanErrorCode` extraction here keeps this PR's additions from pushing
`_recordSpan` over the threshold on their own.

### Rebased onto the merged #410

This landed after #410 was squash-merged, so the branch was rebased onto the new
`main` and the duplicate commit dropped. Two changes `main` had gained since the
branch was cut were preserved rather than reverted: the `fallback` span flag
with its `localAttempted` accounting, and the pre/post-local deadline checks
plus the "an expired window is not an engine failure" cooldown condition — all of
which were ported into `local_first_execution.ts` with the rest of the attempt.

---

## Rollback

Self-contained and behavioural, not merely a revert: the deduplicator is a
pass-through for a single caller, so removing it restores exactly the previous
behaviour with no state, schema or configuration to unwind. The one visible
difference if left in place is a duplicate concurrent request costing nothing,
which is the intent.

---

## Out of scope

Deliberately not attempted, per the issue's guidance to stop speculative
optimization without a demonstrated bottleneck: exact result caching across
calls, agent trigger/fingerprint suppression, provider prompt-cache tuning,
combat prefetch tuning and local concurrency tuning. Each needs its own
measured baseline first — which C-564's telemetry now provides.
