# Lane plan — #381 optional decision runtime (readiness foundation)

Author-recorded **before** implementation, per lane policy. Deviations are
recorded in the rollout report, not edited away here.

| Field | Value |
| --- | --- |
| Base SHA | `98df13ddc041e58c1d501363240d727e23935b96` (`origin/main`, fetched at lane start) |
| Branch | `feat/381-optional-decision-runtime` |
| Worktree | `/home/sonny/.herdr/worktrees/aikami/feat-381-optional-decision-runtime` (herdr workspace `wPP`) |
| Refs | Refs #381, Refs #382 (programs — never "Closes") |
| Contract | `C-567` reserved from the current tree (highest shipped was `C-566`) |
| PR | **draft**, one PR against `main` |
| Changed-file budget | hard cap < 100; planned ~16; see §6 for why this is far below the 60–85 target |

---

## 1. Inputs, verified against today's tree (not the review snapshot)

The reviewed snapshot was `6325e9bc` with #417 merged. All of A, B and C are now
merged into `main`; their **final results** were read, not their proposals.

| Lane | PR | Final result |
| --- | --- | --- |
| A (admission/envelope) | #417 | merged |
| B (request identity / lifecycle) | #418, #420 | merged |
| C (decision contract + evaluation) | #419 | merged — **recommendation: NO-GO for live routing** |

C's own conclusion (`docs/audits/381-decision-evaluation.md` §7) is
**NO-GO for live preference, GO for the foundation**, and its §7.4 evidence-gap
list names the single largest gap as *"no live model measurement at all"*.

### 1.1 Go/no-go applied

This lane's rule is explicit: **if C did not find a backend AND a pilot passing
the declared gates, do not fabricate a live rollout.**

C found neither:

- **No measurable backend.** Ollama is `0.34.3`; `/v1/systemone` returns 404
  (System One needs ≥ `0.35.0`); `nimble` is not pulled; `laya`/`laya.cpp`/
  `opendecider` are not installed; the hosted Jev route has no configured budget.
- **The one pilot failed its own predeclared gate.** Held-out accuracy `0.500`
  against a required `0.85`, for the deterministic baseline. Accuracy counts
  abstentions as misses, so this is not a survivorship artefact.

**Re-probed today, at lane start, not copied from C's table:**

| Probe | Result today | Same as C (2026-10-01)? |
| --- | --- | --- |
| `ollama --version` | `0.34.3` | yes |
| `POST /v1/systemone` | `404` | yes |
| `GET /api/tags` | models present, **no `nimble`** | yes |
| `laya` / `laya-cli` / `opendecider` on PATH | absent | yes |

Nothing in the environment changed, so the recommendation stands.

**⇒ This lane takes the NO-GO branch.** It ships the readiness/validation/setup
foundation behind an explicit experimental opt-in with the **gameplay preference
disabled**, and opens a **draft** PR stating the missing evidence. It does not
download or package a runtime to make the PR larger, and it does not wire a
decision backend into any shipping call site.

## 2. What this lane therefore delivers

Three things, all demonstrable **with no model installed**:

1. **Real readiness detection.** C's §4 lists six backends as `skipped` and
   §7.4 gap 1 as "no live measurement". The blocker for the next measurement is
   that nobody can tell *why* a backend is unusable, in a form a user can act
   on. `probeDecisionBackend` answers that, and — per C's own `DecisionAdapter`
   contract, "a listening socket is not readiness" — it requires a **successful
   schema-validated sample decision**, not an HTTP 200 or a `/models` listing.
2. **The opt-in measurement consumer that does not exist.** C §4 explicitly
   notes: *"No such consumer exists yet."* This lane adds it, env-gated, so the
   next person with a budget runs one command instead of writing a harness.
3. **A diagnostics surface** that answers "why is this task not eligible, and
   what is the effective route?" from the frozen compiler/policy API.

Plus the audit the lane owns: `docs/audits/381-decision-runtime-rollout.md`.

## 3. Ownership boundary

Owned and touched:

| Path | Why |
| --- | --- |
| `packages/frontend/ai-gateway/src/lib/decision/readiness.ts` | provider-neutral readiness verdict |
| `packages/frontend/ai-gateway/src/lib/decision/systemone_readiness.ts` | System One / Ollama dialect specifics |
| `packages/frontend/ai-gateway/src/lib/decision/probe_case.ts` | canonical content-free probe |
| `packages/frontend/ai-gateway/src/lib/decision/preference.ts` | explicit experimental opt-in, default off |
| `packages/frontend/ai-gateway/src/lib/decision/diagnostics.ts` | effective-route / why-not report |
| `packages/frontend/ai-gateway/src/lib/decision/live_measurement.ts` | env-gated live scorer |
| `packages/frontend/ai-gateway/src/lib/decision/index.ts` | this module's own barrel |
| `packages/frontend/ai-gateway/tests/decision_*.test.ts` | dedicated tests |
| `docs/audits/381-*.md`, `docs/contracts/C-567-*.md` | audit, plan, contract |

Deliberately **not** touched, and why — these are the boundaries that keep this
lane honest:

- **No live call site.** No combat, dialogue or agent path imports the decision
  module. The gameplay preference is disabled, so there is nothing to disable in
  production.
- **No vault schema bump / no migration.** The provider/connection/role schema
  and its v3→v4 migration are in this lane's *stated* ownership, but on the
  NO-GO branch persisting a new `decision` capability for a feature with no
  routing would be a schema-version change with no user-visible behaviour, and
  it collides with the shared-registry reservation. Deferred with reasons in
  §6.3.
- **No wizard / no i18n / no settings view models.** They would render a toggle
  for a capability that is disabled and unmeasured.
- **No managed-runtime installer**, no model catalogue entry, no download.
  C's rule: do not download or package a runtime merely to make a PR large.
- **Not D's text surface:** no text prompt, context, reuse or text-service
  internals. A/B's lifetime/admission/transport interfaces are *consumed*
  (`DecisionRequest` already carries `deadlineAt`/`signal`/`requestId`/
  `stateRevision` from C) and never edited.
- **Shared hotspots untouched:** no `text_task.ts`, no root manifest, no
  `bun.lock`, no shared barrel outside this module, no `.context/llms.txt`, no
  common AI baseline harness.

## 4. Interfaces published

All on `@aikami/frontend-ai-gateway/decision`, additive to C's frozen §2 API:

```
probeDecisionBackend({ adapter, probe, deadlineAt, signal, requestId, stateRevision })
  → { state: 'ready', capability, sample }
  | { state: <one of the not-ready states>, capability?, reason, setupText }

createSystemOneReadinessProbe({ transport, model, runtimeVersion, limits? })
  → DecisionReadinessProbe

DECISION_EXPERIMENTAL_PREFERENCE   // explicit opt-in, enabled: false
resolveDecisionPreference({ ... }) → policy-first resolution order

buildDecisionDiagnostics({ schema, policy, preference, probe })
  → per-task effective route + why-not, credential-free

runLiveDecisionMeasurement({ adapter, splits, gates, repetitions })
  → measured rows, or an explicit 'skipped' with the reason
```

No new gateway capability, no new connection kind, no new package. The module
compiles with **no model present**, which is the property C was careful to keep.

## 5. Test plan

Every new file has a failing-first regression; each of these must fail if the
readiness logic is weakened:

| Test | Asserts |
| --- | --- |
| `decision_readiness.test.ts` | a `200 OK` on a route that answers nothing is **not** ready; a `/models` listing without a sample decision is **not** ready; a sample whose value fails original schema validation is **not** ready; actionable setup text per state; no credentials in setup text |
| `decision_systemone_readiness.test.ts` | runtime `< 0.35.0` → `unsupported-runtime` with the exact installed version; missing model → `model-missing`; absent scoring capability → `capability-missing`; body over `SYSTEM_ONE_MAX_BODY_BYTES` refused before dispatch; never truncated |
| `decision_preference.test.ts` | default is **disabled**; explicit disable wins over an enabled backend; disabled role respected; preference never enables itself |
| `decision_diagnostics.test.ts` | effective route reported; compiler rejection reasons surfaced by path; no secret material in output |
| `decision_live_measurement.test.ts` | **skips cleanly and says why** when unconfigured; never reports a pass without measurements; refuses p95 claims below the declared repetition count |

Verification: `bun moon run frontend-ai-gateway:test --force`,
`:typecheck --force`, `:fix --force`,
`bun run scripts/src/lib/ops/run_guards.ts`, `bun moon ci --base=origin/main`,
and pi `validate`.

## 6. Changed-file budget

**Hard cap: < 100. Planned: ~16.** This is deliberately far below the 60–85
target, and the reason is the NO-GO branch, not laziness.

### 6.1 What is not padding

The instruction is explicit that a correct small PR beats artificial size. On
this branch there is no runtime to install, no routing to wire, no pilot to
enable, and no wizard to build — C's evidence forbids all four. Adding files to
approach 60 would mean exactly the prohibited filler: mechanical churn,
one-file-per-fixture splits, or duplicated tests.

### 6.2 What this PR is *not* claiming

No success is claimed for any measurement that did not run. Every quality,
latency and contention number in the rollout report is either (a) C's, cited to
its audit and re-probed for environment facts, or (b) explicitly marked
unavailable.

### 6.3 Deferred boundary, stated up front

| Deferred | Trigger to pick it up |
| --- | --- |
| Provider/connection/role `decision` schema + vault migration | a backend passes the frozen gates |
| Wizard / settings / i18n / managed installer | same |
| Pilot wiring at the NPC command-kind call site | same |
| Resource-contention measurement | a warm decision model exists to contend with |

#381 stays **open**. The end-to-end and quality criteria remain unmet, and the
rollout report lists exactly which ones.