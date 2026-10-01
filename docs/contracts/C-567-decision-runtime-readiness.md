---
id: C-567
title: "Decision-runtime readiness: probe, opt-in preference, diagnostics, live-measurement consumer"
source: "issue"
contract_type: thin
status: implemented
github:
  issue_number: 381
  issue_url: "https://github.com/BearlySleeping/aikami/issues/381"
  project_item_id: null
  pr_url: null
created_at: "2026-10-01T12:00:00+02:00"
updated_at: "2026-10-01T12:00:00+02:00"
---

# C-567 — Optional decision runtime: readiness foundation

| Field | Value |
| --- | --- |
| **Status** | implemented (NO-GO branch of #381: foundation only, no live routing) |
| Promotion | — |
| Priority | P1 (unblocks the measurement C-566 could not take) |
| Slice | #381 slice 5 — evaluation, without enabling anything |
| Depends on | C-566 (merged, PR #419), #417/#418/#420 (merged) |
| Baseline reviewed | `main` at `98df13ddc041e58c1d501363240d727e23935b96` |

---

## Problem

C-566 shipped the compiler, the contracts and the frozen gates, and then
answered the question honestly: **NO-GO for live routing.** Two findings block
any rollout:

1. **No decision backend was measurable.** Ollama `0.34.3`; `/v1/systemone`
   404 (needs ≥ `0.35.0`); `nimble` not pulled; `laya`/`laya.cpp`/
   `opendecider` absent; the hosted route unbudgeted. Six of seven ledger rows
   are `skipped`, not scored.
2. **The single pilot failed its own predeclared gate** — held-out accuracy
   `0.500` against a required `0.85`, counting abstentions as misses.

So there is no live rollout to ship. What *is* missing, and is genuinely
buildable now, is the machinery that turns "we could not measure it" into
"here is exactly what is missing, and here is one command to run once it is
there".

C-566 named that gap itself: *"No such consumer exists yet"* — the live
evaluation harness that would score a real backend against the frozen gates.

## Solution

A readiness/validation foundation that is fully demonstrable **with no model
installed**, plus the missing measurement consumer.

### 1. Readiness that means ready

`probeDecisionBackend` returns a verdict per backend, and per C-566's own
`DecisionAdapter` contract — *"a listening socket is not readiness"* — a
backend is `ready` only after a **successful schema-validated sample
decision**. An HTTP 200, a `/v1/models` listing, or a bound port are each
explicitly insufficient, and each has a regression test.

Not-ready states are specific and actionable rather than a boolean:
`unsupported-runtime`, `model-missing`, `capability-missing`,
`incompatible-dialect`, `oversize`, `sample-rejected`, `unreachable`,
`unauthorized`, `deadline-exceeded`, `cancelled`. Each carries setup text that
is credential-free.

`createSystemOneReadinessProbe` implements the same contract for the
`jev-v1` dialect: version floor, actual model availability, scoring-capability
presence, the 64 KiB body bound enforced **before** dispatch with no truncation,
and the actual selected checkpoint/runtime reported verbatim.

### 2. Explicit experimental opt-in, default off

`DECISION_EXPERIMENTAL_PREFERENCE` is a declared preference with
`enabled: false`. Resolution order is policy-first: explicit model/connection
override, then disabled roles, then allowed local/cloud modes, then
language/context/choice limits, then remaining budget. The preference can never
enable itself, and an explicitly disabled role is never overridden by the mere
existence of a ready backend.

### 3. Diagnostics

`buildDecisionDiagnostics` reports the effective route and — when there is
none — the compiler rejection reasons addressed by property path, using C-566's
frozen API. No secret material in output.

### 4. The opt-in measurement consumer

`runLiveDecisionMeasurement` scores a real backend against the **frozen**
`PILOT_QUALITY_GATE` / `PILOT_LATENCY_GATE`, over the existing dev and held-out
splits, with accepted and abstained cases reported separately so a backend
cannot win by abstaining on everything. It **skips cleanly and says why** when
unconfigured, and refuses percentile claims below a declared repetition count.

## Non-goals — the boundary this contract deliberately does not cross

- **No live routing.** No shipping call site imports the decision module. The
  gameplay preference is disabled.
- **No runtime download, install or upgrade.** Not Ollama, not `laya.cpp`.
- **No vault schema bump / migration / wizard / i18n.** Persisting a new
  `decision` capability for a feature that cannot route would be a schema
  version with no behaviour behind it, and would collide with the shared
  registry reservation.
- **No quality or latency claim.** Nothing here was measured against a real
  model, because no model could be run.

## Verification

`bun moon run frontend-ai-gateway:test --force`, `:typecheck --force`,
`:fix --force`, `bun run scripts/src/lib/ops/run_guards.ts`,
`bun moon ci --base=origin/main`.

## Outcome

Refs #381, Refs #382 — programs, so `Refs` rather than `Closes`. #381 stays
open; the rollout report lists the criteria that remain unmet.