# Strictness Coverage Matrix

**Contract C-476** (originally), extended by the guard-system hardening contract.

This matrix documents the **current** enforcement state. It is kept in sync with
the guard registry — `scripts/src/lib/ops/guards/registry.ts` — by
`scripts/src/lib/ops/__tests__/guard_registry.test.ts`. Adding, removing or
renaming a guard without updating this file **fails that test**. Changes to any
cell require a PR with explicit reviewer approval.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Enforced | Checked in CI — failure blocks the PR |
| ⚠️ Ratchet | Checked in CI against a per-file baseline — may only go down |
| 🔒 Waiver | Enforced through a temporary, expiring, non-raisable waiver |
| 🚫 Exempt | Explicitly disabled — see reason |
| — Not applicable | Rule does not apply to this category |

## Guard categories — read this before interpreting any cell

Not every check means the same thing. The category decides how a failure should
be read and what the correct response is.

| Category | What it means | Failure response |
|---|---|---|
| **hard invariant** | An architectural or security boundary. There is no baseline and no exception. | Fix the code. Never seek an allowance. |
| **ratchet** | Existing debt is recorded per file and may only shrink. | Fix the violation. The baseline cannot be raised, by you or by `--update-baseline`. |
| **maintainability** | A coarse signal about module responsibility or control flow. Not an architecture proof. | Look at the file. Extract a responsibility or flatten the control flow. |
| **temporary waiver** | Explicit, owned, expiring debt for a mutable module. | Reduce the file, or ask a human for a renewed waiver. Never extend `reviewBy` yourself. |
| **policy** | Detects changes to what counts as acceptable debt. | A policy expansion needs the `guard-policy-approved` label (maintainer action). |

> 🔴 A maintainability signal is not the same thing as a hard invariant. LOC is
> not complexity; complexity is not architecture; neither is code quality. Do
> not treat a warning the way you treat a security boundary — and do not treat
> a security boundary the way you treat a warning.

## A. Lint — Correctness

| Rule | `apps/frontend/client` | `apps/frontend/hub` | `apps/frontend/site` | `apps/frontend/docs` | `packages/shared` | `packages/frontend` | `packages/backend` | `apps/backend` | `scripts` | `.pi` | `apps/e2e` |
|------|---|---|---|---|---|---|---|---|---|---|---|
| `noUnusedVariables` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noUnusedImports` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noConsole` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 CLI | 🚫 Pi TUI | 🚫 tests |
| `noExplicitAny` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 tests |

## B. Lint — Style

| Rule | `apps/frontend/client` | `apps/frontend/hub` | `apps/frontend/site` | `apps/frontend/docs` | `packages/shared` | `packages/frontend` | `packages/backend` | `apps/backend` | `scripts` | `.pi` | `apps/e2e` |
|------|---|---|---|---|---|---|---|---|---|---|---|
| `useNamingConvention` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 tests |
| `useFilenamingConvention` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `useArrowFunction` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noNonNullAssertion` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noNestedTernary` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `useBlockStatements` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `useImportType` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `useConsistentTypeDefinitions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noRestrictedImports` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noRestrictedGlobals` (frontend) | ✅ | ✅ | — | — | — | ✅ | — | — | — | — | — |
| `noRestrictedGlobals` (backend) | — | — | — | — | — | — | ✅ | ✅ | — | — | — |

## C. Lint — Complexity (maintainability advisory)

`complexity/noExcessiveCognitiveComplexity` is **not** enabled in `biome.json`,
deliberately. 393 files in this repository currently contain a function above
the default threshold of 15; enabling it as `warn` would make
`biome check --error-on-warnings` (which several packages' `:fix` scripts run)
fail on all of them at once, turning a maintainability signal into a
repository-wide red build.

The measurement is taken by Biome via `--only`, and ratcheted by
`scripts:guard-cognitive-complexity`. See section D.

| Rule | Coverage | Enforcement |
|------|---|---|
| `complexity/noExcessiveCognitiveComplexity` | `apps/`, `packages/`, `scripts/`, `.pi/` | ⚠️ ratcheted by `scripts:guard-cognitive-complexity` |

## D. Structural guards

Every guard below is registered in `scripts/src/lib/ops/guards/registry.ts`.
`wholeRepo` marks a guard whose correctness depends on reading the whole
repository — those are **also** run unconditionally by the PR gate, outside
Moon's affected-project graph (see section F).

| Guard | Task | Category | Whole repo | Baseline / mechanism | What it covers |
|---|---|---|---|---|---|
| MVVM conventions | `scripts:guard-mvvm-conventions` | ratchet | no | `guard_mvvm_conventions_baseline.json` | `apps/frontend/client`, `apps/frontend/hub` views and ViewModels |
| Service conventions | `scripts:guard-service-conventions` | ratchet | no | `guard_service_conventions_baseline.json` | `*_service.svelte.ts` under `client` and `hub` |
| Image component | `scripts:guard-image-component` | hard invariant | no | none | every `.svelte` in `client` and `hub` |
| Data plane | `scripts:guard-data-plane` | hard invariant | no | none | `hub` server code, `packages/backend/database` |
| Type safety | `scripts:guard-type-safety` | ratchet | **yes** | `guard_type_safety_baseline.json` (with violation identities) | `apps/`, `packages/`, `scripts/`, `.pi/` |
| Orphaned capability | `scripts:guard-orphaned-capability` | ratchet | no | `guard_orphaned_capability_baseline.json` (symbol identities) | runtime exports in `client/src/lib/services` |
| Test boundary | `scripts:guard-test-boundary` | hard invariant | **yes** | none | production `src/` under `apps/` and `packages/` |
| ViewModel composition | `scripts:guard-view-model-composition` | ratchet | no | `guard_view_model_composition_baseline.json` | `client/src/lib/views` |
| Source file size | `scripts:guard-source-file-size` | maintainability + 🔒 waivers | **yes** | `guard_source_file_size_baseline.json`, `guard_source_file_size_exemptions.json`, `guard_source_file_size_waivers.json` | `apps/`, `packages/`, `scripts/`, `.pi/` |
| Cognitive complexity | `scripts:guard-cognitive-complexity` | maintainability | **yes** | `guard_cognitive_complexity_baseline.json` | `apps/`, `packages/`, `scripts/`, `.pi/` |
| Guard policy diff | `scripts:guard-policy-diff` | policy | **yes** | none | guard implementations, baselines, waivers, `biome.json`, Moon tasks, CI wiring |
| Workspace boundary | `scripts:guard-workspace-boundary` | runtime (git hook) | no | none | pipeline agents' git operations — not part of the CI aggregate |

`scripts:guard` aggregates every guard with `aggregate: true`.
`scripts:guard-whole-repo` aggregates the whole-repo subset.

### D.1 Ratchet semantics (identical for every ratcheted guard)

Shared implementation: `scripts/src/lib/ops/guards/ratchet.ts`.

* existing debt is recorded per file, per rule, in a baseline;
* `--update-baseline` is **reduction-only** — it synchronizes improvements and
  removals and refuses to add or raise a single count;
* the trusted base revision (`--base-ref` / `AIKAMI_GUARD_BASE_REF` / `BASE_REF`)
  is the authority: any growth relative to it fails, and an unreadable
  explicitly-configured base **fails closed**;
* same-count identity replacement (a different violation where an accepted one
  was) is treated as growth, not as a no-op;
* an improvement that is not yet locked in is a failure, so headroom cannot be
  silently re-consumed — and the sanctioned validation flow locks it in
  automatically (`scripts:guard-contract`).

### D.2 Source-file-size policy

| Representation | File | Rules |
|---|---|---|
| grandfathered baseline | `guard_source_file_size_baseline.json` | may only shrink; `--update-baseline` refuses growth |
| permanent exemption | `guard_source_file_size_exemptions.json` | declarative data, generated-but-tracked artifacts, cohesive fixtures. No expiry, but the classification is **verified** against the file and the ceiling is still a ratchet |
| temporary waiver | `guard_source_file_size_waivers.json` | mutable modules above the hard limit. Requires `issue` **and** `reviewBy`; expires; ceiling may only be lowered |

🔴 The guard compares the **effective allowance** — the single ceiling a path
actually has, whichever file expresses it — against the trusted base revision.
Converting a baseline entry into a larger waiver, or the pre-split
`guard_source_file_size_exceptions.json` into a larger waiver, is therefore
detected as an increase rather than as a representation change.

## E. Tooling coverage by area

| Area | Biome lint | Structural guards |
|------|---|---|
| `apps/frontend/client` | ✅ | ✅ `guard-mvvm-conventions`, `guard-service-conventions`, `guard-image-component`, `guard-orphaned-capability`, `guard-view-model-composition`, `guard-type-safety`, `guard-test-boundary`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `apps/frontend/hub` | ✅ | ✅ `guard-mvvm-conventions`, `guard-data-plane`, `guard-image-component`, `guard-type-safety`, `guard-test-boundary`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `apps/frontend/site`, `apps/frontend/docs` | ✅ | `guard-type-safety`, `guard-test-boundary`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `packages/shared` | ✅ | `guard-type-safety`, `guard-test-boundary`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `packages/frontend` | ✅ | `guard-type-safety`, `guard-test-boundary`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `packages/backend` | ✅ | `guard-data-plane`, `guard-type-safety`, `guard-test-boundary`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `apps/backend` | ✅ | `guard-type-safety`, `guard-test-boundary`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `scripts/` | ✅ | `guard-type-safety`, `guard-test-boundary`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `.pi/` | ✅ | `guard-type-safety`, `guard-source-file-size`, `guard-cognitive-complexity` |
| `apps/e2e/` | ✅ (narrowed) | — (test tree; `guard-type-safety` exempts T1/T2 here, T3 still applies) |
| Generated skills (`.pi/generated-skills/`) | 🚫 excluded | — |
| SvelteKit build artifacts (`.svelte-kit`) | 🚫 excluded | — |

## F. How guards reach CI

| Path | What runs | Affected-aware? |
|---|---|---|
| PR / push to `main` — "Structural guards (whole-repo)" step | `scripts:guard-whole-repo` (type safety, test boundary, source file size, cognitive complexity, policy diff) | **No — unconditional** |
| PR / push to `main` — `moon ci` | the full `scripts:guard` aggregate for affected projects, plus lint/format/typecheck/test | yes |
| Contract pipeline pre-push gate | `:fix`, `:typecheck`, `scripts:guard-whole-repo`, `scripts:guard-policy-diff`, `scripts:guard-contract`, then `:validate` as the verdict | whole-repo steps are unconditional |

🔴 A guard that reads the whole repository must never be gated on Moon's
affected-project graph. Before the unconditional step existed, a push to `main`
whose diff resolved to nothing skipped those guards entirely, and four oversized
files reached `main` unnoticed (PR #339).

## G. Guard-policy changes

`scripts:guard-policy-diff` classifies a diff that touches guard implementations,
ratchet baselines, waivers/exemptions, `biome.json` lint severity, Moon guard
tasks or CI guard wiring, and prints `GUARD POLICY CHANGE` with one of three
verdicts:

| Verdict | Meaning | Blocking? |
|---|---|---|
| debt reduction | every changed allowance went down or away | no — reductions are always allowed |
| policy refactor | policy files changed without relaxing anything | no — review for a deleted rule |
| policy expansion | an allowance grew or appeared, or a lint severity was relaxed | **yes, without authorization** |

Authorization is the maintainer-applied `guard-policy-approved` label, which CI
surfaces as `AIKAMI_GUARD_POLICY_AUTHORIZATION`. Applying a label requires write
access to the repository, so an autonomous agent cannot grant it to itself.

Ownership of these files is recorded in `.github/CODEOWNERS`. Branch protection
requiring review from those owners is a repository-settings follow-up that this
document cannot enforce by itself.

## H. Exceptions with reasons

| Category | Rule Disabled | Reason |
|----------|---------------|--------|
| `apps/e2e/**` | `noConsole` | Test logging and debug output |
| `apps/e2e/**` | `noExplicitAny` | Test mocks and fixture types |
| `apps/e2e/**` | `useNamingConvention` | Test naming patterns |
| `scripts/**` | `noConsole` | CLI tools produce stdout/stderr output |
| `scripts/**` | `useNamingConvention` | CLI, environment, and external payload identifiers follow tool-defined names |
| `.pi/**` | `noConsole` | Pi agent extensions and scripts use `console.log` for TUI/logging output |
| `.pi/**` | `useNamingConvention` | Agent extension and external API identifiers follow host-defined names |
| `**/*.d.ts` | `useConsistentTypeDefinitions` | Declaration files use `interface` for ambient declarations |
| `**/*.d.ts` | `useNamingConvention` | Declaration files follow ambient naming conventions |

## Scope Boundaries

This matrix is a claim about **actual** enforcement, not aspirational coverage.
If a cell here is wrong, the matrix is the bug — fix it in the same PR that
changed the enforcement. The registry parity test exists so that omission is
detected rather than discovered later.
