---
id: C-566
title: "Decision-contract foundation: schema compiler, provider-neutral contracts, evaluation harness"
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

# C-566 — Decision-contract foundation and evaluation

| Field | Value |
| --- | --- |
| **Status** | implemented |
| Promotion | — |
| Priority | P0 (foundation for #381) |
| Slice | #381 slices 1 and 5 — schema compiler and evaluation |
| Depends on | — |
| Baseline reviewed | `main` at `6325e9bc5bd959dceef180de2a73827707c25054` |

---

## Problem

Issue #381 proposes preferring an optional decision model for eligible
enum/boolean inference. Two things have to be true before any of that is safe,
and neither existed:

1. we can **prove**, per real shipping schema, whether a decision model could
   produce a legal value at all; and
2. we have **measured evidence** about whether one is worth having.

The proposed alternative was a provider-specific `isLayaCompatible` flag. That
is the wrong shape: it bakes one vendor's limits into a question that is
genuinely vendor-neutral, and it cannot express *why* a schema is ineligible.

## Solution

### A pure, provider-neutral compiler

`packages/frontend/ai-gateway/src/lib/decision/` exports
`analyzeDecisionSchema({ schema, limits })`, returning either a typed
`DecisionPlan` or a list of `{ code, path, detail }` reasons addressed to the
exact property that blocked it.

Two properties matter more than coverage:

- **Nothing is discarded to reach compatibility.** A keyword the compiler does
  not fully understand is a rejection, not a warning. There is no code path that
  can skip one, so a schema can never be reported "compatible" while meaning
  more than the plan enforces.
- **Structural compatibility is not a routing decision.** `bindDecisionPolicy`
  is a separate, explicit second gate. A schema can compile perfectly and the
  task still refuses to be asked — which is the normal outcome, and the reason
  this contract ships no routing.

Supported: booleans, homogeneous finite literal choices (`enum` and TypeBox
`anyOf`-of-`const`), singleton constants resolved without inference, closed
required fixed objects and nested objects, and a bounded local-`$ref` subset
with cycle and external-ref rejection.

### Correlated choices require explicit legal tuples

Independent `action` and `target` questions permit `heal` + `enemy`: legal under
the schema, wrong for the game. A task must declare a mode per correlated path
set. `combination` bounds the Cartesian product and filters it against authored
`legalTuples` in declared path order; only matching tuples become options. An
empty or over-wide expansion is refused before dispatch. `reject` emits nothing;
`staged` is refused until it can enforce legal tuples. Correctness depends on
the task author declaring the correlations and allowed tuples accurately.

### Thresholds are task metadata

`resolveBooleanPolicy` compares the model's stated probability **for the answer**
— never entropy, never the wire's `confidence` field — against per-task
accept/confident thresholds, with a conservative default that is deliberately
not `0.5`.

### One bounded pilot, measured, and a NO-GO

`tests/decision_pilot.ts` defines the single pilot: NPC dialogue command-kind
selection, the only closed finite discriminator on the interactive path that
survives compilation. `tests/decision_evaluation.test.ts` scores it over a
31-case development split and a 28-case held-out split, against gates frozen
before any backend ran.

The result is a **NO-GO for live preference**: no decision backend was runnable
in this environment (Ollama 0.34.3, `/v1/systemone` → 404, no `nimble` model;
laya.cpp, laya-python and opendecider not installed; hosted Jev reachable but
with no configured budget), and the one measurable backend — a zero-cost
deterministic baseline — fails the predeclared quality gate at 0.500 held-out
accuracy against a 0.85 requirement.

Full evidence, per-schema inventory, and the frozen API for step E are in
[`docs/audits/381-decision-evaluation.md`](../audits/381-decision-evaluation.md).

## Why this is not #381 implemented end-to-end

It is not, and this contract does not claim it is. Delivered: the compiler, the
contracts, the adapters, the fixtures, the gates, and a measured recommendation.
Not delivered, deliberately: any routing, any wizard or settings surface, any
runtime installation, any download, and any change to a live text path. Step E
owns that gate, and this contract's job was to make the gate decidable on
evidence rather than on upstream marketing.

## Acceptance criteria

- [x] Supported and rejected schema cases have compiler tests, including exact
      value reconstruction and constraint preservation.
- [x] A constraint the compiler does not implement is refused, never dropped.
- [x] Correlated fields cannot bypass semantic validation.
- [x] Reconstructed output is validated against the ORIGINAL schema, plus the
      caller's existing domain validation.
- [x] Cache is keyed by schema content and compiler version; a changed schema
      invalidates it.
- [x] Local refs, ref cycles, hostile property names, non-finite probabilities,
      wrong/missing answer ids, unknown option keys, oversize input, unsupported
      language, deadline and cancellation are all covered by tests.
- [x] Backends that could not be run are marked `skipped` with reproducible
      setup commands — no fabricated rankings.
- [x] Measured results, limitations and remaining issue criteria are published.
- [ ] **Deferred to step E:** at least one actual enum/boolean call site
      implemented end-to-end; live comparison of deterministic / existing-LLM /
      Laya / Nimble behaviour; warm/cold p50/p95, queue time, memory, residency
      and concurrent frame-time impact; native parity against a pinned
      reference; setup → install → sample inference → enable → gameplay →
      disable/uninstall.

## Deviations from the lane plan, and why

| Planned | Done instead | Reason |
| --- | --- | --- |
| fixtures + harness under `scripts/evaluation/` | fixtures + harness under `packages/frontend/ai-gateway/tests/` | The harness needs both the analyzer and `@aikami/schemas`. Hosting it in `scripts/` requires a new cross-project dependency and a `bun.lock` change — an integration hotspot, and a one-time registration this slice does not need. Hosted in the package, the registry scan and the evaluation ledger run as **tests**, which is strictly better: a schema edit that changes a verdict fails CI instead of silently invalidating the report. |
| `moon.yml` / root manifest / lockfile registration | none | No new project. Only `packages/frontend/ai-gateway/package.json` gained an `exports` entry for the `./decision` subpath, avoiding any change to a shared barrel. |

## Files changed

New module: `packages/frontend/ai-gateway/src/lib/decision/` (10 files).
Tests: `packages/frontend/ai-gateway/tests/decision_*.test.ts` plus
`decision_pilot.ts` and two fixture data files.
Docs: `docs/audits/381-decision-evaluation.md`,
`docs/audits/381-lane-plan.md`, this contract.
Manifest: `packages/frontend/ai-gateway/package.json` (`exports` only).

## Evidence Matrix — Production Path

**Production path: none.** This contract deliberately ships no production
consumer. `guard-orphaned-capability` is scoped to
`apps/frontend/client/src/lib/services/**`, so the exported runtime capability
here is not reported by it; this row records the same fact in prose so a
reviewer can see the intent rather than infer it.

Step E consumes it through `@aikami/frontend-ai-gateway/decision`.