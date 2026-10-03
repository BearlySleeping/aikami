# Native llama.cpp decision models — #381 follow-up

Review baseline: `main` at `683b6b932` (#425, merged 2026-10-03).
Pinned runtime: `llama.cpp` commit `a4cb4c61fd9d9c2066c7c1747821d3d65b8943bd`
(upstream [ggml-org/llama.cpp#29818](https://github.com/ggml-org/llama.cpp/pull/29818),
merged 2026-10-02, supports laya / julia-1 / lev / openjev / kev).

## Verdict

**Capability: shipped. Gameplay for `npc-action-selection`: NO-GO on this task,
with the gate still closed.**

Two different claims, and they must not be collapsed:

| claim | status |
|---|---|
| Aikami can talk to native `/v1/systemone`, configure it, test it, and report readiness honestly | **yes** — adapter, config, settings UI, persisted Off/Shadow/On, 71 adapter tests + 20 wiring tests |
| `npc-action-selection` is accurate enough, safe enough and fast enough to route | **no** — three checkpoints measured, none clears any of the three gates |
| #382: a native decision call makes the dialogue path cheaper | **no** — it makes it *longer* on this hardware; measured |

No gameplay routing is enabled. `qualifiedForGameplay` defaults to `false` and the
qualification gate refuses every backend measured here. Shadow is available and
is the only mode that can be selected.

## 1. The wire contract, verified rather than assumed

`/v1/systemone` is **not** the `jev-v1` shape Ollama serves. They share a route
name and disagree on nearly everything that matters:

| fact | `jev-v1` (Ollama ≥ 0.35.0) | native llama.cpp |
|---|---|---|
| request `model` field | required | **not part of the contract** |
| `noul` answer | `answers[q].value` (boolean) | `answers[q].noul` (**number, p(true)**) |
| `noul` `probabilities` / `confidence` | present | **absent by construction** |
| "not a decision model" | n/a | **HTTP 501** |
| `usage.output_tokens` | runtime-defined | **always 0** |
| `choice` option ceiling | runtime-defined | **per checkpoint** (52 OpenJev, 255 Laya) |

Confirmed in upstream source at the pin
(`tools/server/server-decision.cpp:611` writes `answer["noul"] = probs[i]` for the
option keyed `"true"`; `tools/server/server-context.cpp:5367` returns 501 when
`decision.type == COMMON_DECISION_TYPE_NONE`; the same handler hardcodes
`{"output_tokens", 0}`), and in every captured response in
`docs/audits/381-native-evidence/`.

### Defects this found in Aikami's own code

Four were caught by running against a real server, not by reading:

1. **`answers[q].value` for a native `noul` yields `undefined`.** Every boolean
   decision abstained and the failure presented as a *policy refusal* rather than
   a wire mismatch. Fixed: the adapter reads the numeric `noul` and derives
   `probabilities = {true: p, false: 1-p}` — exact by construction, not an
   estimate — which is what the existing task threshold policy already consumes.
   Thresholds are applied **before** reconstruction (the existing runner order),
   so an uncertain boolean abstains instead of being rounded to `false`.
2. **`/props` `build_info` is the string `"b11361-a4cb4c61f"`**, not the
   `{version, build_commit, build_number}` object the first implementation read.
   Consequence: every real server reported a runtime label with no commit, which
   is the one field that makes "does this build contain the endpoint" checkable.
3. **`/props.model_path` is a filesystem path**; a player configures a name. A
   literal comparison reported a correct configuration as serving the wrong model.
4. **An empty `state` is silently dropped by `JSON.stringify`**, producing
   `{"questions":{…}}`, which upstream answers with a 400 that names nothing
   useful. The adapter now refuses locally and says so.

`runtime_probe.ts` also used to route everything non-Ollama through the `jev-v1`
probe. `llamacpp` is now refused there explicitly and served by its own adapter,
rather than falling through to the wrong rules.

## 2. What was measured

All raw artifacts, with per-run identity and hashes, are in
`docs/audits/381-native-evidence/` (`CHECKSUMS.sha256` lists them).

Hardware: 32-thread x86-64 CPU, 31 GB RAM, RTX 4090 Laptop GPU **present but
unused** (no CUDA toolkit on this host — see §5). Build: CPU-only `llama-server`
at the pinned commit. Checkpoints: hashes and sizes in `checkpoint-manifest.tsv`.

### 2.1 Protocol smoke (before any quality claim)

Against `tinylaya-for-testing-Q8_0.gguf`, upstream's own test fixture, using
upstream's `TEST_STATE`: `choice` + two `noul` answered 200; empty `questions`
answered 400. Captured verbatim in `captured-laya-*.json`.

The two testing checkpoints are semantically **flat** — every `noul` within
0.5014–0.5018 of chance, `confidence` 0.0015. They validate the protocol and
nothing else, which is exactly what they are for.

### 2.2 Two real checkpoints, development split only

Threshold calibration used a permissive policy so the **raw** `p(chosen)` was
recorded; the frozen `choicePolicy {0.75, 0.95}` was then applied unchanged.
20 dev cases (12 positive, 8 required-abstain), the corrected #425 harness, the
same corpus and the same frozen gates.

| checkpoint | file size | load | warm p50 | warm p95 | dev recall | false acceptances |
|---|---|---|---|---|---|---|
| Julia-1 Q8_0 | 160 MB | 3 s | 2088 ms | 3232 ms | 0.42 | **4** (8 unthresholded) |
| Laya Q8_0 | 449 MB | 2 s | 1627 ms | 1720 ms | 0.17 | 2 |
| OpenJev Q4_K_M | 19 GB | 107 s | **213 837 ms** (single request) | — | not run | — |

Frozen gates: recall ≥ 0.85, false acceptances ≤ 0 (absolute), coverage ≥ 0.90,
warm p50 ≤ 250 ms, warm p95 ≤ 750 ms.

**Every checkpoint fails every gate it can be measured against.** OpenJev is
UNAVAILABLE, not FAIL: one 379-token decision request took 214 s on CPU, so the
per-case deadline expired before any case could be scored.

### 2.3 The two real checkpoints fail in OPPOSITE directions

This is the most useful thing in the run, and it is why no threshold can rescue
either:

- **Laya over-abstains.** It answers `none` on 9 of 12 positives.
- **Julia-1 over-acts.** It returns a state-changing action on **8 of 8**
  required-abstain cases.

Neither is a calibration problem. **Confidence does not separate right from
wrong for either checkpoint.** For Julia-1 the two *highest*-confidence
dev answers are `dev-elder-evidence-01` at p=0.9963 (wrong: offered a quest
instead of taking the ledger) and `dev-elder-gossip-01` at p=0.9974 (unsafe:
an action where the fixture says nothing is warranted). Raising the threshold
removes correct answers long before it removes those.

Full curves (`thresholdCurve` in the calibration artifacts) sweep 0 → 1.01:
Laya's recall never exceeds 0.17 at any threshold; Julia-1's never exceeds 0.42
at any threshold with ≥ 4 false acceptances.

This is a **task-level** NO-GO, not a capability NO-GO. The diagnosis points at
the task's own shape — per-turn candidate enumeration with payload-bearing
literals (`offerQuest:fading_ward`) plus a first-class `none` — rather than at
the wire, the adapter, or the checkpoints. A candidate/consumer change is the
next experiment, not a threshold change.

### 2.4 Latency scales with context, not with the model

`laya-context-latency.json`, 6 timed samples after 1 discarded warm-up:

| input tokens | 36 | 173 | 457 | 1309 | 3865 |
|---|---|---|---|---|---|
| p50 (ms) | 144 | 760 | 2222 | 8873 | 48769 |

Linear prefill at ~12.6 ms/token on this CPU. The dev corpus's real states are
100–200 tokens, which is why the measured p50 is ~1.6 s rather than the ~50 ms
a short-question benchmark would show.

**Consequence for #382: on this hardware a native decision call ADDS ~1.6–2.1 s
to a dialogue turn.** It does not remove work. The generative call for NPC
action selection is *not* eliminated by accepting a decision — call 2 still
generates choices — so this would be an additional inference, not a saving.

### 2.5 What was NOT measured, and is therefore not claimed

- **No GPU run.** No CUDA toolkit on this host. Every latency number is CPU. A
  GPU build would be substantially faster in prefill; by how much is unmeasured.
- **No held-out split was scored.** The existing held-out split was inspected in
  #425, so it is not a sealed holdout. Scoring it here would produce a number
  that looks like qualification and is not.
- **No co-residency measurement.** Narrative + decision in two processes, model
  switching and resource contention were not run.
- **No managed install was exercised end to end in the UI.** The artifact
  pipeline (`ModelAssetStore`, `download_integrity`) is reused, not re-measured.
- **No E2E screenshot of the settings flow** in this revision.
- **Not every advertised checkpoint was evaluated.** The task does not require
  it; `lev` and `kev` were not run.

### 2.6 Comparators

The deterministic lexicon and the constrained-chat comparator are **not**
re-measured here. Both appear in #425's published table and are cited there with
their conditions. Re-deriving the lexicon arm would mean hand-writing match
rules against the labelled dev split — tuning a comparator against its own
answers — so the CLI has no `--arm=deterministic`, and this report does not
present a re-measured control. #425's `qwen3:14b` figure also came from an
Ollama text model this environment does not run.

## 3. What ships

- `native_llamacpp_dialect.ts` — the native wire shape: numeric `noul`, 501,
  nested-object error bodies, per-checkpoint refusal vocabulary. `score` and
  image input are **refused with a named reason**: upstream serving them is not
  a reason to widen what Aikami is willing to send.
- `checkpoint_limits.ts` — per-checkpoint ceilings with an attributed source.
  OpenJev keeps 52 and Laya keeps 255; an unknown family gets the **smallest**
  published ceiling, not the largest. Over-limit plans are **refused, never
  truncated** — truncating asks a different question and reconstructs from an
  answer nobody gave.
- `llamacpp_adapter.ts` — no `model` field, `noul` as a probability, 501 as
  not-a-decision-model, `/props` identity, `is_sleeping`-aware residency, one
  absolute deadline, real `output_tokens: 0` usage reported as observed.
- Registry / config / resolution — `llamacpp` is its own runtime kind with its own
  adapter; `gameplayMode` is persisted Off/Shadow/On, defaulting to `off`.
- Settings UI — "llama.cpp — decision models" in AI Settings → Decisions, with a
  real choice+boolean Test connection, and an Off/Shadow/On selector whose rows
  carry their own refusal reasons. `on` is refused while unqualified; `shadow` is
  deliberately **not** gated, because shadow discards its result.

Two further defects the work surfaced and fixed:

- The qualification gate hardcoded `supportedDialect: 'jev-v1'`, so a native
  connection was judged against a dialect it never claimed to speak.
- After turning that into a set, a test caught the sharper version: **`jev-v1`
  evidence still qualified a native connection**, because set membership alone
  does not compare the measurement to *this* backend's dialect. Both conditions
  are now enforced independently, and each mismatch is named separately.

## 4. Gates and qualification evidence

No versioned qualification record is issued, because nothing cleared a gate. The
record shape (`DecisionQualificationEvidenceSchema`: task, task version, dialect,
checkpoint, run id, timestamp) already existed and is unchanged. Its absence
means FAIL CLOSED. `qualifiedForGameplay` remains a master switch that can only
narrow; it cannot manufacture a qualification.

The measured dev numbers are **not** promoted to qualification evidence, and
there is no code path that would let a measured artifact be written as one
without a held-out run having cleared the frozen gates.

## 5. Reproduction

```bash
# pin + build (CPU; add -DGGML_CUDA=ON with a CUDA toolkit installed)
git clone https://github.com/ggml-org/llama.cpp && git checkout a4cb4c61
cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DGGML_NATIVE=ON \
      -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON
cmake --build build -j --target llama-server

# serve a checkpoint
build/bin/llama-server -m Laya-Q8_0.gguf --port 8410 -c 4096 -b 2048 -ub 2048 \
      --parallel 1 --seed 42 --threads 16

# dev measurement with the corrected #425 harness and its frozen gates
bun run src/cli/decision_native_llamacpp_measure_node.ts \
  --endpoint=http://127.0.0.1:8410 --checkpoint=Laya-Q8_0.gguf --split=dev

# dev-only threshold calibration (refuses --split=heldout)
bun run src/cli/decision_native_calibrate_node.ts \
  --endpoint=http://127.0.0.1:8410 --checkpoint=Laya-Q8_0.gguf
```

## 6. Remaining gaps

**#381** — capability support is done for native llama.cpp. Open: the task itself
(`npc-action-selection`) is unqualified on every checkpoint measured, and the
evidence above points at the task's candidate shape rather than at the runtime.

**#382** — nothing here makes dialogue cheaper. The honest position is that a
native decision call is an **additional** inference on a path that already makes
a generative call for choices. Whether it can pay for itself needs a GPU
measurement and a task whose accuracy justifies it.

**Next experiment, in order:**
1. Rebuild with CUDA and re-measure latency. The 250 ms p50 gate is the cheapest
   of the three to clear and the current failure is CPU-shaped.
2. Attack the task shape: a boolean/one-of-two formulation, or candidates
   without payload-bearing literals. Aiming a benchmark at dormant built-in
   agents is explicitly rejected — any alternative needs an authoritative
   candidate set, a real call site and a frozen gate.
3. Only then, a **new sealed holdout**. The existing held-out split has been
   inspected and cannot serve.