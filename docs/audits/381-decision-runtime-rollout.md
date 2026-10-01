# #381 — Optional decision runtime: rollout report (readiness foundation)

| Field | Value |
| --- | --- |
| Contract | C-567 |
| Refs | Refs #381, Refs #382 (programs — never "Closes") |
| Base SHA | `98df13ddc041e58c1d501363240d727e23935b96` (`origin/main`) |
| Head SHA | see PR |
| Branch | `feat/381-optional-decision-runtime` |
| PR | #421 — review-ready; live routing remains NO-GO |
| Recommendation | **NO-GO for live routing stands.** Ship the readiness foundation; route nothing. |

> **Status of this PR.** The lane initially opened as a draft, because the
> go/no-go rule for a NO-GO branch said to open a draft PR stating the missing
> evidence. The readiness foundation itself is now complete and review-ready, so
> it was promoted to normal review. **The missing live-model evidence remains a
> blocker for enabling automatic decision routing and for closing #381 — not a
> blocker for merging this isolated foundation.** The safety gates are unchanged
> by that promotion; nothing here was weakened to make the PR look complete.

---

## 0. The one-paragraph answer

This lane was told: ship one optional decision capability using the winning
supported runtime plus one real gameplay pilot, **unless** the previous lane
found no backend and no passing pilot — in which case do not fabricate a
rollout, finish the readiness/validation/setup foundation behind an explicit
experimental opt-in with the gameplay preference disabled, and open a draft PR
saying what evidence is missing.

> That draft-opening instruction was satisfied as written. What follows is the
> same NO-GO conclusion, and it is unchanged: the missing live evidence blocks
> **live routing**, which is a different thing from blocking this foundation.

**The previous lane found neither.** C-566 (#419, merged) closed with an
explicit **NO-GO**, and re-probing the environment today reproduced its result
exactly. So this PR ships no routing, no pilot wiring, no wizard, no runtime and
no model. What it does ship is the machinery that turns *"we could not measure
this"* into *"here is exactly what is missing, and here is one command to run
once it is there"* — plus one genuine correctness fix that the previous lane
left in place.

## 1. Inputs, verified today rather than inherited

All three dependencies are merged; their **final results** were read:

| Lane | PR | Final result |
| --- | --- | --- |
| A | #417 | merged |
| B | #418, #420 | merged |
| C | #419 | merged — **NO-GO for live routing** |

The reviewed snapshot was `6325e9bc` with #417 merged. Current `main` is
`98df13dd`. Every finding below was re-verified against today's tree; nothing
was taken on trust from the snapshot or from C's tables.

### 1.1 Go/no-go, applied

C found no measurable backend **and** its one pilot failed its own predeclared
gate (held-out accuracy `0.500` against a required `0.85`, with abstentions
counted as misses).

Re-probed at lane start:

| Probe | Today | C's 2026-10-01 reading |
| --- | --- | --- |
| `ollama --version` | `0.34.3` | `0.34.3` |
| `POST /v1/systemone` | `404` | `404` |
| `GET /api/tags` | models present, **no `nimble`** | same |
| `laya` / `laya-cli` / `opendecider` on PATH | absent | absent |

Nothing changed, so the recommendation stands unchanged. **NO-GO branch taken.**

## 2. The correctness fix — a false `ready` that made #381 unmeasurable

C-566's `DecisionAdapter` contract says readiness "must reflect a real check. A
listening socket is not readiness, and a dialect that parses is not a checkpoint
that has answered."

**Its own adapter did not honour that.** `capability()` returned `ready: true`
as soon as `/api/version` answered `200`. On the machine this was written on,
Ollama `0.34.3` answers `/api/version` with `200` and `/v1/systemone` with
`404` — so the adapter would have declared a backend ready that cannot answer a
single decision. That is a large part of why C had nothing measurable: the
readiness signal it had to work with was wrong.

**Regression first.** `tests/decision_systemone_readiness.test.ts` fails against
the old behaviour:

- `a 200 on the version route alone does NOT make the adapter ready` — asserts
  `ready === false` on exactly the 0.34.3 configuration above.
- `an endpoint with no decision route at all is not ready`.

**Fix.** Readiness is now two explicitly separate layers, because conflating
them is what produced the bug:

| Layer | Owner | Question | Cost |
| --- | --- | --- | --- |
| **Dialect readiness** | `probeSystemOneBackend` | can this endpoint serve `jev-v1` at all? version floor → checkpoint installed → advertised scoring capability | two GETs, no inference |
| **Checkpoint readiness** | `probeDecisionBackend` | did a real decision get answered, and does the value satisfy the **original** schema? | one sample decision |

An endpoint that passes layer 1 has **not** earned a routing decision. Only
layer 2 returns `ready`.

**One existing C-566 test changed**, and it is worth naming rather than burying:
`provenance uses the probed runtime and the configured checkpoint` used
`version: 'test-runtime'` and passed only because *any* 200 meant ready. It now
uses `0.36.1`, and asserts the probed version. That test encoded the buggy
behaviour; leaving it would have meant preserving the bug.

## 3. What was delivered

| File | Responsibility |
| --- | --- |
| `readiness.ts` | checkpoint readiness via a sample decision; 11 specific not-ready states; credential-redacted reasons; actionable setup steps |
| `systemone_readiness.ts` | dialect readiness: version floor, checkpoint availability, advertised scoring capability |
| `probe_case.ts` | the synthetic, content-free probe (closed two-option discriminator) |
| `preference.ts` | the experimental preference — **ships disabled** — and policy-first resolution |
| `diagnostics.ts` | effective route plus which stage produced the verdict |
| `live_measurement.ts` | the gated measurement consumer C-566 said did not exist |

### 3.1 Two distinctions this lane is careful about

**Readiness is not correctness.** A successful sample proves the checkpoint is
loaded, speaks the dialect, emits a distribution, and produced a schema-legal
value. It proves nothing about whether the answer is *right*. A wrong-but-legal
answer is `ready`; `tests/decision_readiness.test.ts` pins that. Only the
held-out split scoring in `live_measurement.ts` says anything about quality.

**Readiness is not presence.** A `/v1/models` listing containing the checkpoint,
an HTTP 200, and a bound port are each explicitly insufficient, each with its
own regression.

### 3.2 A second bug the tests caught during this lane

The first draft of `measureSplit` counted `positives` only among *answered*
cases — dividing by however many the backend was willing to attempt. That is
precisely the survivorship bias C-566 spent a paragraph warning about: a
backend that abstains on every hard case would have scored a **perfect
accuracy**. The denominator is now counted before dispatch, and
`a backend that always abstains cannot pass by refusing to answer` fails without
the fix.

### 3.3 Policy-first resolution

`resolveDecisionPreference` checks, in order: explicit override → opt-in →
disabled role → cloud/privacy → hard limits → readiness. Readiness is the
**last** gate, so a ready backend cannot buy its way past policy. The shipped
preference is `{ enabled: false, tasks: [], allowCloud: false }`; enabling it
alone still opts in nothing, because opt-in is per task. There is no global
"all enum schemas route to the decision model" switch and no provider-compatibility
business flag.

## 4. Evidence

**Environment** — see §1.1. Re-probed today, not inherited.

**Correctness of the readiness logic** — proven against an injected transport.
Every claim about the wire contract is a claim about *this code*, and a passing
mock proves a contract, never a provider's behaviour or a model's accuracy.

**Verification actually run** (all with `--force`, none cached):

| Check | Result |
| --- | --- |
| `bun moon run frontend-ai-gateway:test --force` | **473 pass, 0 fail** (was 242 at C-566) |
| `bun moon run frontend-ai-gateway:typecheck --force` | pass |
| `bun moon run frontend-ai-gateway:fix --force` | pass |
| `bun run scripts/src/lib/ops/run_guards.ts` | **10/10 pass** |
| `bun moon ci --base=origin/main` | see PR body |

**No baseline, waiver or ceiling was changed.** The first commit attempt failed
the cognitive-complexity guard with 8 recorded-debt growths and 1 type-safety
growth; all 9 were fixed by extracting named helpers (`bindProbe`,
`sampleVerdict`, `probeRuntimeVersion`, `probeCheckpoint`, `evaluateGates`,
`scoreCase`, `summarize`, `bindTask`, `reportNoBackend`, `reportWithBackend`) and
by widening `DecisionReadinessProbe.schema` to `unknown` so no caller needs a
cast. The guard then went green with the baseline untouched.

### 4.1 Measurements explicitly **unavailable**

No claim is made for any of these, because no backend could be run:

- **Accuracy / coverage / risky-false-acceptance on any model.** No model ran.
- **Warm or cold latency, p50 or p95.** Nothing to measure. Note the harness
  itself refuses to emit a percentile below `MIN_REPETITIONS_FOR_PERCENTILE = 20`,
  and a latency gate that cannot be evaluated **fails** rather than passing.
- **Memory, frame time, narrative-model eviction.** Unmeasured.
- **Native parity against a pinned reference.** Not attempted; no native runtime.
- **Brier / calibration.** Not computable, as in C-566.

`runLiveDecisionMeasurement` returns `status: 'skipped'` with a reason when no
adapter is supplied, and the skipped branch has **no `passed` field at all** —
there is no way to read a skip as a success.

## 5. Limitations

1. **Nothing is routed, so nothing is proven in production.** Every readiness
   path here is exercised by tests and by synthetic probes.
2. **No pilot is wired at the NPC command-kind call site.** C's quality gate
   failed, so there is no evidence a decision model beats the existing path.
3. **No provider/connection/role schema, no vault migration, no wizard, no i18n,
   no managed installer.** Deliberately deferred: on the NO-GO branch these would
   be a persisted schema version with no behaviour behind it, and they collide
   with the shared-registry reservation.
4. **The version floor is one runtime's.** `SYSTEM_ONE_MIN_RUNTIME_VERSION`
   encodes what Ollama's `/v1/systemone` requires. A runtime that speaks the
   dialect at a different floor would be wrongly refused until someone measures
   it. The floor is a declared constant, not a discovered fact.
5. **Scoring-capability detection is a filter, not a proof.** A checkpoint whose
   runtime advertises no capability list at all is deliberately *not* failed —
   absence of evidence is not evidence of absence, and the sample decision is the
   real proof.
6. **C-566's measurement caveats still hold**: 59 authored cases, one author,
   one language, no inter-annotator agreement, no real transcripts by design.
7. **Not-ready classification reads adapter prose.** `DecisionCapability`
   exposes `notReadyReason` as a string (C-566's seam), so
   `stateForNotReady` classifies the specific state — old runtime, missing
   checkpoint, absent capability — by matching that prose. It is correct for
   every reason this module produces (each is pinned by a test), but a
   differently-worded third-party adapter could be classified as `unreachable`
   rather than the more precise state. The fix is a typed reason on the adapter
   seam, which would change C-566's published `DecisionCapability` contract and
   is therefore out of scope here.

## 6. Rollback

Delete the five new modules and the four new test files, drop the C-567 export
block from `decision/index.ts`, and revert the `capability()` body in
`systemone_adapter.ts` plus its one adjusted test assertion in
`tests/decision_adapters.test.ts`.

**No saved campaign, vault, setting or text configuration is touched**, and no
shipping call site imports any of it, so there is nothing else to unwind.

## 7. Remaining #381 acceptance criteria

**These are NOT required for merging this isolated readiness foundation.** They
are required before enabling automatic live decision routing, and before #381
can be closed. They are deferred rollout evidence, tracked by #381.

**Unchanged — #381 stays open.** Still unmet:

- [ ] Live comparison of deterministic / existing-LLM / decision-model behaviour on Aikami fixtures.
- [ ] At least one enum/boolean call site end-to-end (the pilot is **not** wired).
- [ ] Warm and cold p50/p95, queue time, memory, residency, concurrent frame-time impact.
- [ ] Resource contention against narrative generation while a decision model is resident.
- [ ] Native parity against a pinned reference.
- [ ] Setup → install → sample inference → enable → gameplay → disable/uninstall.
- [ ] Calibrated thresholds, larger and multi-author corpora, non-English coverage.

Still satisfied by C-566 and untouched here: compiler tests, constraint
preservation, correlated-field handling, and the declined-schema cases.

### 7.1 What would unblock the next step

One command, which this lane adds and C-566 lacked:

1. Provide a decision backend that reports ready (`probeDecisionBackend` →
   `ready`). `describeDecisionReadiness` prints the setup steps if it does not.
2. Hand that adapter to `runLiveDecisionMeasurement` with the **frozen**
   `PILOT_QUALITY_GATE` and `PILOT_LATENCY_GATE`.

A `measured` result is a measurement, not an approval. Routing stays blocked
until held-out accuracy ≥ 0.85 **including abstentions**, risky false acceptance
≤ 5 %, coverage ≥ 0.50, legal-value rate 1.00, and no measurable regression to
narrative generation.

## 8. Reproducing

```bash
bun moon run frontend-ai-gateway:test --force
bun moon run frontend-ai-gateway:typecheck --force
bun moon run frontend-ai-gateway:fix --force
bun run scripts/src/lib/ops/run_guards.ts
```

## 9. Changed files

**16** (hard cap 100). Deliberately far below the 60–85 target: on the NO-GO
branch there is no runtime to install, no routing to wire, no pilot to enable
and no wizard to build, and padding to 60 would mean exactly the prohibited
filler — mechanical churn or duplicated tests. A correct small PR beats an
artificially large one.

- 6 new modules — `packages/frontend/ai-gateway/src/lib/decision/**`
- 5 new test files — `tests/decision_{readiness,systemone_readiness,preference,diagnostics,live_measurement}.test.ts`
- 1 modified module (`systemone_adapter.ts`) and 1 modified test (`decision_adapters.test.ts`) — the correctness fix
- 1 modified module barrel (`decision/index.ts`)
- 2 docs — this report, `381-runtime-lane-plan.md`, and `docs/contracts/C-567-decision-runtime-readiness.md`

**Integration hotspots:** none. No root manifest, no `bun.lock`, no shared
barrel outside this module, no `text_task.ts`, no provider config, no wizard, no
common AI baseline harness, no `.context/llms.txt`.

## 10. Superseded work, recorded rather than skipped

- **C-566's `ready: true` from a version probe** — superseded by §2. The old
  behaviour was wrong on this machine; the regression is pinned.
- **C-566's `provenance ... configured checkpoint` test** — updated, not deleted;
  it asserted a real runtime and now asserts a real, parseable one.
- **Nothing from D's text surface was taken.** This lane reads no text prompt,
  context or text-service internals, and integrates no unmerged branch.