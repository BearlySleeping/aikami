# Lane plan — #381 decision-contract foundation and evaluation

Author-recorded **before** implementation, per lane policy. Everything below is
committed; deviations are recorded in the final report, not edited away here.

| Field | Value |
| --- | --- |
| Base SHA | `6325e9bc5bd959dceef180de2a73827707c25054` (`origin/main`, fetched at lane start) |
| Branch | `feat/381-decision-contract-evaluation` |
| Worktree | `/home/sonny/.herdr/worktrees/aikami/feat-381-decision-contract-evaluation` (herdr workspace `wPG`, label `aikami-381-decision`) |
| Refs | Refs #381, Refs #382 (programs — never "Closes") |
| Contract | `C-566` reserved from the current tree (highest shipped was `C-565`) |
| Changed-file budget | hard cap < 100; target 60–85; stop growth at 85 |

---

## 1. Problem this lane actually addresses

Issue #381 asks for an *optional* decision-model path in front of eligible
enum/boolean inference. Two things must be true before any of that is safe:

1. we can prove, per real shipping schema, whether a decision model could
   produce a **legal** value at all (a pure, provider-neutral question); and
2. we have measured evidence about whether one is worth having.

Neither exists today. So this lane ships the compiler, the contracts, the
fixtures, and the evidence — and deliberately ships **no** live routing, no new
runtime, and no end-to-end task. That boundary is the deliverable, not a
shortfall: step E owns the gated integration and this lane's job is to make
that decision on measured evidence rather than on upstream marketing tables.

## 2. Ownership boundary

Owned and touched by this lane:

| Path | Why |
| --- | --- |
| `packages/frontend/ai-gateway/src/lib/decision/**` | new cohesive decision-contract module |
| `packages/frontend/ai-gateway/tests/decision_*.test.ts` | its dedicated tests |
| `packages/frontend/ai-gateway/package.json` | one subpath export so `@aikami/frontend-ai-gateway/decision` is the public API without churning the shared `src/index.ts` barrel |
| `scripts/evaluation/decision/**` | isolated evaluation fixtures, harness, scan |
| `docs/audits/381-decision-evaluation.md` | the audit + go/no-go report |
| `docs/audits/381-lane-plan.md` | this document |
| `docs/contracts/C-566-*.md` | the contract shell for this slice |

Explicitly **not** touched (other lanes' or shared hotspots): live text
transport, the text service, `text_task.ts` task presets, provider config /
migrations, the setup wizard, the common AI baseline harness
(`apps/e2e/scripts/ai_baseline_*`), `packages/shared/schemas`, root manifests,
`bun.lock`, `.context/llms.txt`, any other `src/index.ts` barrel.

The new package needs no `moon.yml`, root manifest entry, or lockfile change: it
is a subdirectory module inside an already-registered package, which is exactly
what `STRUCTURE.md` asks for and avoids the one-time registration integration.

## 3. Interfaces the lane publishes

All in `@aikami/frontend-ai-gateway/decision`:

- `analyzeDecisionSchema({ schema, policy })` → `{ ok: true, plan }` or
  `{ ok: false, reasons }`. Pure, provider-neutral, no vendor flag.
- `DecisionPlan` / `DecisionQuestion` — bounded, stable-path typed questions.
- `createDecisionPlanCache({ maxEntries })` — content+version+compiler-version
  keyed.
- `reconstructDecisionValue({ plan, answers, originalSchema })` → validated
  value, or typed failure. Always re-validates against the ORIGINAL schema.
- `DECISION_INCOMPATIBILITY_CODES` — stable machine codes.
- Capability/result contracts (`DecisionCapability`, `DecisionResult`,
  `DecisionProvenance`) with no `/v1/systemone` DTO types leaking in.
- Adapters: deterministic baseline (runnable now) and a JEV-dialect HTTP
  transport (contract-tested, not wired).

## 4. Test plan

Regression-before-fix for every correctness rule named in the lane brief:
accepted and rejected schemas; nested reconstruction with exact type
preservation; key-order invariance; changed-schema cache invalidation; `$ref`
cycles and external refs; hostile property names; correlated choices;
non-finite and out-of-range probabilities; wrong/missing answer ids; unknown
option keys; oversize-input refusal; unsupported language; deadline and
cancellation; schema-valid-but-domain-invalid answers.

Run through `bun moon run frontend-ai-gateway:test` (never a bare `bun test`),
plus `frontend-ai-gateway:typecheck`, `bun run scripts/src/lib/ops/run_guards.ts`,
and `bun moon ci --base=origin/main`.

## 5. Measurement plan and predeclared honesty rules

- Quality gate and latency gate are **predeclared in the report before** any
  backend is scored.
- A backend that cannot run here is reported as `skipped` with a
  missing-evidence status and reproducible setup/run commands. No fabricated
  rankings.
- Protocol equality is not model equivalence; upstream speed and accuracy
  figures are vendor claims and are labelled as such.
- No paid calls (no configured budget/permission for a hosted API here).
- No upgrade of the shared Ollama daemon mid-benchmark.

## 6. Execution-time facts that shape the outcome

Captured at lane start, on this machine, not from the review snapshot:

- Installed Ollama is **0.34.3**; `POST /v1/systemone` returns **404**.
  System One needs **>= 0.35.0** plus the `nimble` model, which is not present.
  So the Nimble/Ollama path is not measurable here without upgrading a shared
  daemon — which this lane will not do.
- `laya.cpp`, the `laya` Python package, and `opendecider` are not installed.
- Hosted TypeSafe/Jev is reachable but has no configured budget/permission for
  paid calls, so it stays contract-tested only.

This makes "no candidate justifies live preference yet" a likely *measured*
conclusion rather than an assumed one. The lane is built so that conclusion is
still useful: the compiler, contracts, fixtures and harness are what step E
consumes, and they are fully exercised with no model installed.