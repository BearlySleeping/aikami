# #381 — Do decision models help Aikami? Audit, evidence and recommendation

| Field | Value |
| --- | --- |
| Contract | C-566 (foundation + evaluation slice) |
| Refs | Refs #381, Refs #382 |
| Base SHA | `6325e9bc5bd959dceef180de2a73827707c25054` |
| Lane | `feat/381-decision-contract-evaluation` |
| Recommendation | **NO-GO for live routing.** Keep the compiler and contracts; do not enable a decision backend yet. |

---

## 0. The one-paragraph answer

We built the provider-neutral compiler #381 asks for and then used it to audit
every shipping schema Aikami can reach. **Of the whole registry, exactly one
closed finite discriminator on the interactive path survives compilation** — the
NPC dialogue command kind — and it survives only because we defined the pilot
*around the discriminator* rather than around the schema the code actually calls.
Every other candidate is rejected by a specific, named reason. On top of that,
**no decision backend was runnable in this environment** (Ollama is 0.34.3;
`/v1/systemone` returns 404; laya.cpp, laya-python and opendecider are not
installed; the hosted Jev API has no configured budget), so the model rows below
carry `skipped`, not a score. The one thing we could measure — a zero-cost
deterministic baseline — clears coverage but **fails the predeclared quality
gate on held-out data (0.50 against a 0.85 requirement)**. The honest
conclusion is that the opportunity is real but narrow and unproven, and the
correct next step is a gated measurement, not an integration.

---

## 1. Task inventory — what we actually audited

`packages/frontend/ai-gateway/tests/decision_registry_scan.test.ts` encodes
this table as assertions, so a schema edit that changes a verdict fails a test
instead of silently invalidating this document.

Legend for **compiler verdict**: ✅ compiles · ❌ rejected with the stated code.

| Call site (schema) | Reachable by default | Schema-compatible | Semantically suitable | Current engine/parser alternative | Latency / frequency | Consequence of a wrong answer | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NpcDialogueAiEnvelopeSchema` (npc dialogue turn) | yes, every AI NPC turn | ❌ `unsupported-property-type` (narrative prose) + `optional-field` | no — narrative is generation, not decision | none; it *is* the generation call | interactive, per turn | player-visible prose wrong | ❌ |
| `NpcDialogueExtractionSchema` (C-401 call 2) | yes, per AI NPC turn | ❌ `optional-field` ×2 | no — absent means "nothing extracted" | none | interactive, 2nd call per turn | a real state change via `command` | ❌ |
| `NpcDialogueCommandSchema` (the command union) | yes, inside the above | ❌ `unsupported-property-type` (`questId`, `itemId`, `difficultyClass`, `quantity`) | no — payload is free text/ints | none | with dialogue | real state change | ❌ |
| **NPC command-kind discriminator** (`kind` const across the 7 variants) | yes | ✅ | **yes** | none today; parser only handles explicit commands | interactive, per turn | wrong state-changing command | ✅ **pilot** |
| `CombatIntentDraftSchema` (combat-interpreter) | yes | ❌ `unsupported-array` (`steps`, `fallback`) | no — sequences and target ids | **deterministic interpreter exists** | interactive, 1.5 s soft deadline | combat step against a stale revision | ❌ |
| `CombatEventEnvelopeSchema` | yes | ❌ free-form event payload | no | engine emits these | per event | engine state divergence | ❌ |
| `NpcSuggestionChipSchema` | yes | ❌ free strings (`id`, `label`, `prefillText`) | no | none | per turn | unusable chip text | ❌ |
| `NpcSuggestionChipIntentTypeSchema` (5-label union) | yes | ✅ | partly — a chip may legitimately have no intent | none | per turn | wrong chip icon/priority | ✅ structurally, ❌ semantically (multi-valued) |
| `NpcDialogueSkillSchema` (3-label union) | yes, inside `skillCheck` | ✅ | partly — an NPC may warrant no check | **none**; enum is exhaustive | per skill check | wrong DC gating | ✅ structurally, ❌ semantically |
| `BattleTrigger` (inline agent) | agent enabled by default | ❌ `enemy: string` | partly — `battle` alone is a clean boolean | none | background agent phase | spurious combat trigger | ❌ |
| `Relationship` (inline agent) | agent enabled by default | ❌ `magnitude`, `reason` | no | none | background | wrong relationship drift | ❌ |
| `Expression` (inline agent) | agent enabled by default | ❌ `unsupported-array` + free strings | no | none | background | cosmetic | ❌ |
| `BatchedAgentAnalysis` | batched post-analysis | ❌ `unsupported-array` (`questUpdates`) | partly — `battleTrigger` is a clean boolean | none | background batch | spurious combat trigger | ❌ |

### 1.1 The finding that decides the lane

`CombatIntentDraftSchema` is **not** a flat finite schema, exactly as the review
warned: it is a union of two object variants, one carrying a bounded array of
steps, the other a refusal reason. It has no finite option set anywhere. Same
story for every dialogue and agent schema in the table: the eligible part is
always a *sub-part* of a schema the code must fill in full.

That is the whole design tension in #381, stated as data:

> **The schema a decision model can satisfy is never the schema a shipping call
> site sends.** Every candidate is either (a) incompatible as authored, or
> (b) compatible only after the call site is split so that a bounded
> discriminator becomes a first-class request — which is a product change with
> its own semantics, not a routing change.

We chose (b) for exactly one task, deliberately bounded, and measured it. We did
not add a preclassifier in front of every existing LLM call: that would be a
new model call in front of a call that already works, on schemas whose questions
we would have to invent, with no evidence it helps.

### 1.2 Why "agent enums" are not an opportunity

Three agent schemas contain a clean boolean or enum (`BattleTrigger.battle`,
`Relationship.change`, `BatchedAgentAnalysis.battleTrigger`). None is a
production opportunity on this evidence:

- they sit in **background** agent phases, so they are not on an interactive
  path where a sub-250 ms decision would buy anything;
- they are **already batched into one call** with the rest of the agent payload
  (C-565 / #411 coalescing collapsed six identical envelope calls into one), so a
  separate decision call would *add* a request rather than remove one;
- the boolean is only a fraction of a payload the model must fill anyway, so
  routing the boolean elsewhere means splitting the call — new request
  identity, new state revision, new failure mode, for a background task.

---

## 2. What we shipped

A new module, `packages/frontend/ai-gateway/src/lib/decision/`, published as
`@aikami/frontend-ai-gateway/decision`:

| File | Responsibility |
| --- | --- |
| `types.ts` | Provider-neutral contracts, incompatibility codes, capability/provenance/result shapes |
| `analyzer.ts` | Pure schema → plan compiler. No vendor, no I/O, no clock |
| `policy.ts` | Semantic opt-in, instruction requirements, correlation handling, threshold resolution |
| `reconstruct.ts` | Answers → original value, always re-validated against the ORIGINAL schema |
| `dispatch.ts` | Group assembly and pre-dispatch bounds |
| `plan_cache.ts` | Bounded, content+compiler-version keyed cache |
| `dialect.ts` | The **only** file that knows a vendor DTO exists |
| `adapters/` | Deterministic baseline (runnable), `/v1/systemone` dialect transport (contract-tested) |
| `runner.ts` | The single accept/abstain authority |

**Public API, frozen for step E:**

```
analyzeDecisionSchema({ schema, limits? })
  → { ok: true, plan } | { ok: false, reasons: { code, path, detail }[] }

bindDecisionPolicy({ plan, policy, supportedLanguages? })
  → { ok: true, plan, groups } | { ok: false, reasons }

buildDecisionDispatch({ plan, context, limits? })
  → { ok: true, units } | { ok: false, refusal }

runDecision({ plan, schema, policy, adapter, context, deadlineAt, signal,
              requestId, stateRevision, domainValidate?, planCacheHit? })
  → { ok: true, value, answers, provenance } | { ok: false, abstained, reason, provenance }
```

### 2.1 Compiler rules actually implemented

Booleans; homogeneous finite literal choices (`enum` and TypeBox
`anyOf`-of-`const`); singleton constants resolved without inference; closed
required fixed objects and nested objects; a bounded local-ref subset
(`#/$defs/*`, `#/definitions/*`) with cycle and external-ref rejection.

Rejected, by design and by test: arbitrary strings/numbers/integers, arrays,
open records, optional and nullable fields, mixed-type literal sets, empty
enums, conditional schemas (`allOf`/`oneOf`/`not`/`if`), sibling-constrained
`$ref`s, and **any keyword outside the implemented whitelist**. That last rule
is the important one: there is no code path that can silently drop a constraint,
because an unrecognised keyword has nowhere to go but a rejection.

Reconstruction writes through `Object.defineProperty` into null-prototype
objects and refuses `__proto__` / `constructor` / `prototype` at every segment,
as a second line independent of the compiler's own name check.

### 2.2 Correlation, and the trap it avoids

Independent `action` and `target` questions permit `heal`+`enemy`: schema-legal,
game-wrong. Three declared modes:

- `combination` — the compiler expands the legal tuples once (bounded by
  `maxCombinations`, default 32) and asks for one of them. 3 actions × 2
  targets = 6 options, not 6 independent pairings to filter later.
- `staged` — both questions stay, dispatched as one unit inside one deadline.
- `reject` — the default when a correlation is declared with no handling: no
  question is emitted at all.

An expansion that would exceed the bound is refused **before** dispatch.

### 2.3 Thresholds are task metadata, not a global 0.5

`resolveBooleanPolicy` defaults to `accept 0.90 / confident 0.98 / reject`,
deliberately conservative, and every threshold is overridable per task. The
comparison uses the model's stated probability **for the answer**, never its
entropy and never its reported `confidence` — those are different quantities and
`dialect.ts` documents that the wire's `confidence` field is the model's own
figure, not a probability of correctness.

---

## 3. Primary-source evidence, refreshed at execution time

Refreshed on 2026-10-01 against the live documentation, not the review snapshot.

| Source | What it actually says today | How we used it |
| --- | --- | --- |
| [docs.ollama.com/capabilities/decision](https://docs.ollama.com/capabilities/decision) | "Start Ollama **v0.35.0 or later**, then `ollama pull nimble`". Local requests need no API key. `/v1/systemone` takes `state` + `questions{key:{type,instructions,criteria}}`, returns `choice` + `probabilities` + `confidence` + `usage` | Confirmed the dialect and the version floor |
| [docs.ollama.com/api/systemone](https://docs.ollama.com/api/systemone) | 400/404/**413**/500; **"request body must not exceed 64 KiB"**; "input is never truncated"; no streaming | Drove `SYSTEM_ONE_MAX_BODY_BYTES` and the pre-dispatch refusal |
| [lkarlslund/laya.cpp](https://github.com/lkarlslund/laya.cpp) | Now advertises **CUDA, Vulkan, Core ML and CPU** (the review's "CUDA/CPU" is out of date). JEV-compatible `POST /v1/systemone`, automatic request batching, `english`/`multilingual`/`typed-decisions` variants, precision flags | Confirms a second runtime could serve the same dialect — and therefore that dialect ≠ model |
| [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) | Non-autoregressive System 1, 100+ languages, router per checkpoint. Its own BENCHMARKS document **Laya losing to Jev** above 20 options and on soft-distribution matching, and needing `head_max_len` tuning | Vendor benchmark used only as a *risk* signal about high-cardinality label spaces |
| [manjunathshiva/opendecider](https://github.com/manjunathshiva/opendecider) | "calibrated … a probability for every option"; 400M–80B; CPU/NVIDIA/Apple/LM Studio/Ollama/vLLM | Third dialect candidate; not installed |
| [docs.typesafe.ai/api](https://docs.typesafe.ai/api) | Hosted `state` + typed `questions` → `answers` per question | Hosted candidate; requires budget/permission we do not have |

**All speed and accuracy figures on those pages are vendor or project claims.
None is a measurement of Aikami, and none is used in this report as one.**

### 3.1 Installed-environment check (executed, not assumed)

| Probe | Result |
| --- | --- |
| `ollama --version` | `0.34.3` |
| `GET /api/version` | `{"version":"0.34.3"}` |
| `POST /v1/systemone` | **404 page not found** |
| `GET /api/tags` | 14 text/vision models; **no `nimble`** |
| `laya` / `laya-cli` / `laya-server` | not on PATH |
| Python `laya`, `opendecider` | not installed |
| `POST https://api.typesafe.ai/v1/systemone` | 405 (route exists; POST + key + budget required) |
| GPU | NVIDIA GeForce RTX 4090 Laptop, 16 376 MiB, driver 595.104.02 |
| CPU / RAM | 32 cores / 31 GiB |

The review's suspicion was right: **System One needs ≥ 0.35.0 and we run
0.34.3.** Reaching a live Nimble measurement requires upgrading a shared Ollama
daemon that is currently serving this user's text models. We did not do it —
that is a mid-benchmark change to shared state, and it would also invalidate any
before/after latency comparison.

---

## 4. Backend availability ledger

| Backend | Status | Reason |
| --- | --- | --- |
| `deterministic-baseline` | **measured** | In-process authored lexicon; always runnable |
| `ollama` + `nimble` | **skipped** | 0.34.3 installed; `/v1/systemone` → 404; `nimble` not pulled |
| `laya.cpp` | **skipped** | no binary installed |
| `laya` (python) | **skipped** | package not installed |
| `opendecider` | **skipped** | package not installed |
| `typesafe-jev` (hosted) | **skipped** | reachable, but no configured budget/permission for paid calls |
| configured text LLM | **skipped** | no connection exercised in this lane; its adapter contract is unit-tested, not benchmarked |

**No model ranking appears in this report, because none was measured.** The
`skipped` rows are reproduced as data in
`tests/decision_evaluation.test.ts` so the report and the test cannot disagree.

Reproducible setup, for whoever runs this next with a budget:

```bash
# 1. Decision-model runtime (>= 0.35.0; do this on a spare daemon, not a shared one)
ollama pull nimble

# 2. Point the evaluation adapter at it and run both splits
AIKAMI_DECISION_DECISION_URL=http://127.0.0.1:11434/v1/systemone \
AIKAMI_DECISION_VERSION_URL=http://127.0.0.1:11434/api/version \
bun moon run frontend-ai-gateway:test -- --test-name-pattern 'evaluation'

# 3. Alternative runtimes
#   laya.cpp:  build-cuda/bin/laya-cli --server --port 8080 --variant english
#   laya:      pip install laya && python -m laya.serve --port 8080
#   hosted:    export TYPESAFE_API_KEY=...   # requires an explicit budget
```

---

## 5. Fixture corpus

`packages/frontend/ai-gateway/tests/fixtures/decision/` — two files, 59 cases.

- **Split discipline**: `decision_fixtures_dev.json` (31 cases) is the only
  split thresholds may be tuned on. `decision_fixtures_heldout.json` (28 cases)
  was authored after the lexicon was frozen and is reported once.
- **Label provenance**: every label is **authored by this contract** against the
  authored option descriptions in `tests/decision_pilot.ts`. **No LLM judge is
  used as ground truth anywhere in this lane.** Cases that genuinely admit two
  readings carry `"label": "ambiguous"` and `"expected": null`.
- **Categories** (present in both splits): clear intent, ambiguous, negation,
  multiple actions, unsupported actions, invented fantasy names, unseen packs /
  NPCs, misleading quoted instructions, correlated fields, out-of-scope inputs,
  out-of-scope language.
- **Out-of-distribution by construction**: code, JSON, markup and URLs as
  player input; invented proper nouns (`Thal'rynn of the Vexmoor`,
  `Orrin Blackhollow of the Ninth Fen`, `Ashen Compass of Vaeldrin`); German,
  French and Japanese utterances; *negative* cases that contain the very
  keywords the lexicon matches (`The price of grain has doubled`,
  `The guild recruits apprentices every spring`) and *positive* cases that
  contain none of them (`We could use another pair of hands out there`,
  `This was under your floorboards the whole time`).

The negative-keyword and no-keyword positives were added **after** a first
measurement showed the corpus was solvable by surface matching alone. Recording
that is part of the result: the first corpus was not discriminative, and a
recommendation built on it would have been worthless.

---

## 6. Predeclared gates and measured results

Gates were frozen in `tests/decision_pilot.ts` **before** any backend was
scored, and are asserted as constants in the test suite.

**Quality gate**: held-out accuracy ≥ 0.85 (abstention on a positive case
counts as a miss — measuring accuracy only over answered cases is survivorship
bias); risky false acceptance ≤ 5 % of answered cases; coverage ≥ 0.50; legal
value rate = 1.00.

**Latency gate**: warm p50 ≤ 250 ms, warm p95 ≤ 750 ms, cold p95 ≤ 4 000 ms —
anchored to the interactive budget the call would replace, not to a throughput
table.

### 6.1 Deterministic baseline — the only measured backend

| Split | Cases | Positives | Answered | Correct | Accuracy | Answered-only accuracy | Risky false accept | Coverage | Legal values | Brier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dev | 31 | 13 | 18 | 8 | **0.615** | 1.000 | 10 | 0.581 | 18 / 18 | n/a (one-hot) |
| held-out | 28 | 14 | 16 | 7 | **0.500** | 1.000 | 9 | 0.571 | 16 / 16 | 0.25 (n=1 graded case) |

Reading:

- **Every value it produced was schema-legal** (16/16 held-out). That is a real
  result: the compiler + reconstruction path produced no illegal value across 34
  answered cases.
- **It fails the quality gate decisively** (0.500 vs 0.85). Its
  answered-only accuracy of 1.000 is the survivorship-bias artefact the harness
  is built to expose: it answers the easy cases and abstains on the hard ones.
- **Brier is not defensible for this backend.** A lexicon matching one rule
  emits a one-hot vector; scoring that as "perfectly calibrated" would dress an
  artefact up as evidence. The harness therefore computes Brier only over
  genuinely graded distributions, which for this backend is a single held-out
  case (`held-multi-action`, p = 0.5 on two options) — far too few for a number.
  **Brier is reported as unavailable, not as 0.25.**
- **The 10 dev / 9 held-out risky false acceptances are the real signal.** Almost
  every one is a *negative* case where a keyword fired anyway — `The price of
  grain has doubled` matched `price` and returned `trade`. That is exactly the
  failure mode a lexical baseline has and a calibrated model might not.

### 6.2 Latency

**Not measured for any decision backend, because none ran.** For the
deterministic baseline, end-to-end latency is microseconds of in-process string
matching and is not comparable to a model call; reporting it next to a model
number would be a category error.

The only latency numbers in this lane are the deterministic baseline's own
envelope-context passes, and they are not a model measurement either.

What we *can* say, from prior repository evidence rather than from this lane:
`docs/audits/382-ai-baseline-report.md` measured the local text model at
**~2.4–3.6 s warm** and **~6.7–7.9 s cold (n=1, model evicted)** on this
machine, with a **±1 s run-to-run noise band**, and explicitly recorded that
**gameplay/rendering contention was not covered** by any prior measurement. A
decision backend sharing the same Ollama GPU would contend for exactly the
resource whose contention is already unmeasured here.

---

## 7. Recommendation: **NO-GO for live preference**, GO for the foundation

### 7.1 Do not

- Do not add a decision backend to the routing path.
- Do not add a decision preclassifier in front of any existing LLM call.
- Do not download, install or upgrade a runtime to make a benchmark runnable.
- Do not advertise laya.cpp's Vulkan/Core ML/CUDA support in Aikami — upstream
  advertises it; **we validated none of it**.
- Do not present any upstream throughput or accuracy figure as Aikami-visible
  latency.

### 7.2 Do keep

The compiler, the contracts, the adapters, the fixtures and the gates. They are
useful with **no model installed**, they are covered by 242 passing tests, and
they turn "should we use a decision model?" from an opinion into a measurement
with a predeclared pass mark.

### 7.3 Frozen API for step E

Exactly the four calls in §2. Additional guarantees step E can rely on:

- A plan is a pure function of schema content + compiler version. Renaming a
  schema does not invalidate it; editing one option does.
- Reconstruction **always** re-validates against the caller's original schema,
  and accepts a `domainValidate` predicate for the existing domain rules.
- The runner never retries, never auto-selects a backend, and never restarts a
  deadline. Choosing a fallback stays with the caller.
- Every abstention carries a machine-readable reason and full provenance
  (backend id, dialect, checkpoint, runtime, timings, cache hit).

### 7.4 Evidence gaps, in priority order

1. **No live model measurement at all.** The single largest gap. Everything
   downstream depends on it.
2. **Resource contention unmeasured.** Whether a small decision model evicts or
   delays the text model on this GPU is unknown, and prior repository work
   explicitly listed this as uncovered.
3. **Corpus size and authoring.** 59 authored cases from one author. No
   inter-annotator agreement, no player telemetry, no real transcripts (by
   design — privacy). A held-out set this small cannot support a confidence
   interval worth quoting.
4. **Single pilot, single language.** One task, English only. Whether the
   compile-then-decide split generalises to other discriminators is untested.
5. **No calibration measurement.** Thresholds are declared, not calibrated. They
   are conservative by construction and must be calibrated on development data
   before any of them is trusted.

### 7.5 What would change the recommendation

A run of §4's setup with an explicit budget that shows, on the held-out split:
accuracy ≥ 0.85 **including abstentions**, risky false acceptance ≤ 5 %,
warm p95 ≤ 750 ms, **and** no measurable regression to narrative generation
while the decision model is resident. Until then, "no candidate justifies live
preference yet" is the accurate answer, and shipping the foundation is the
correct output of this lane.

---

## 8. Reproducing this lane

```bash
bun moon run frontend-ai-gateway:test --force     # 242 tests, incl. registry scan + evaluation
bun moon run frontend-ai-gateway:typecheck --force
bun run scripts/src/lib/ops/run_guards.ts
```

The registry scan and the evaluation ledger are assertions, not prose: if a
future schema change makes a task eligible, `decision_registry_scan.test.ts`
fails with the property path that changed it.