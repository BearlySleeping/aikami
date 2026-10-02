# #381 — Visible decision settings and a trustworthy live evaluator

| Field | Value |
| --- | --- |
| Refs | Refs #381, Refs #382 |
| Review baseline | `738252d739eb4f7f27af80c6000e5b7de91558a3` |
| Branch | `feat/381-decision-settings-and-live-eval` |
| Recommendation | **Ship the configure → test → sample path. Automatic gameplay routing remains NO-GO.** |
| Model qualification | **BLOCKED — no reachable qualifying backend.** Exact setup and rerun commands below. |

---

## 0. The one-paragraph answer

The previous lane's finding was correct and is preserved: no decision backend on
this machine can serve `/v1/systemone`, so no model has ever been scored. What
was missing was everything that would let a player *reach* that point, and a
scorer that could not be trusted even when reached.

This lane delivers the **configure → test → sample** flow end to end — a visible
**Settings → Decisions / System One** section, real runtime-specific readiness,
vault-backed authentication, and an executable evaluator with distinct
pass / fail / unavailable exits. It also **repairs the scorer**, which was
reporting zero risky acceptance while a backend fired a real command at an
out-of-scope message.

It routes nothing. A settings selection cannot activate a gameplay task, and
the automatic-gameplay gate refuses by construction.

---

## 1. The scorer was wrong, and the wrongness was load-bearing

The shipped live scorer counted a command fired on a case labelled "no command is
warranted" as **coverage** and returned early without incrementing risky
acceptance. Reproduced against the pre-fix code:

> two correct positives + one command on an out-of-scope greeting →
> accuracy 1, coverage 1, risky acceptance 0, safety gate **passed**.

That is a false pass on the exact failure the gate exists to catch, and the test
that pinned it asserted the wrong contract.

Three further defects in the same code:

| Defect | Was | Now |
|---|---|---|
| Negative vs ungradable | `expected: null` meant both | `positive` / `required-abstain` / `excluded`; excluded cases leave every denominator |
| Answered-positive accuracy | documented as "answered positives", divided by all answered | `positiveRecall` (gate) and `answeredPositiveAccuracy` (diagnostic) are separate numbers |
| Case language | fixture `language` ignored; policy language always sent | dispatched per case; an undeclared language **abstains** |
| Output comparison | hard-coded `commandKind ?? Object.values(...)[0]` | the task declares its comparator |
| Cold/warm | caller-asserted on each fixture | established by dispatch order; method recorded on the report |

There is now **one** metric implementation (`decision/metrics.ts`). The live
measurement, the deterministic harness and the evaluator CLI all call it.

Regressions pinned in `tests/decision_metrics.test.ts`:

- two correct positives plus one accepted out-of-scope input reports
  `falseAcceptances = 1` and fails the declared gate;
- coverage is identical whether the out-of-scope answer was safe or unsafe;
- an all-abstain backend scores `positiveRecall = 0` and fails;
- answering only the easy positives reads 1.000 on the diagnostic and still
  fails the gate;
- a fixture whose language the checkpoint does not declare abstains.

---

## 2. The pilot measured the wrong question

Two corrections were made **before** anything was scored.

**`giveItem` was described backwards.** The pilot said "the player hands an item
over to this NPC". `NpcDialogueGiveItemCommandSchema` says the opposite: *"Grants
an item to the player. Requires the NPC to possess the item."* A corpus labelled
against the reversed description grades a model for answering the wrong
question. Both directions are now pinned in both splits.

**There was no ordinary no-command outcome.** The schema required a
`commandKind` from seven state-changing literals, so the backend could not
express "nothing is warranted here" — while `NpcDialogueAiEnvelopeSchema` types
`command` as **optional**. A discriminator that structurally cannot say "no"
measures something the game never does.

The evidence for that second point is the corpus itself. The eighteen opening
player messages the game actually ships
(`apps/frontend/client/src/lib/data/initial_suggestion_presets.ts`, taken
verbatim) were added as fixture cases. **Twelve of the eighteen require no
command.** They were overwhelmingly conversation openers before anyone labelled
them.

The task is now labelled a **research probe** everywhere it is exposed, and
states what it does not prove: it grades a command *kind* with no payload, no ID
resolution and no world precondition, none of which production commands carry.

---

## 3. Runtime readiness was a category error

The old probe required `/api/version` and enforced Ollama's 0.35.0 floor for
*every* backend speaking `jev-v1`. That is an Ollama fact. Laya's HTTP route and
a hosted Jev endpoint serve the same body and have no such route — so every
external backend was refused before it was asked a question.

`runtime: 'jev'` now never requests an Ollama route, treats its checkpoint
listing as advisory, and defers to the sample inference. `runtime: 'ollama'`
keeps the strict two-stage probe. An Ollama entry with no version endpoint is
reported `misconfigured`, not `unsupported-runtime` — different problems deserve
different messages.

Also fixed here:

- **Endpoint-specific backend identity.** `decisionBackendId()` folds the
  endpoint into the identity, so `nimble` on a laptop daemon and `nimble` on a
  hosted account no longer share a cache entry, a readiness record or a
  qualification result.
- **First-class authentication.** `authHeaders` is a resolver, not a stored
  string: a vault-backed credential is read per request so it can be rotated or
  revoked, and it never enters a closure, a log or a provenance record.
- **Real capability limits.** The adapter answered `Number.MAX_SAFE_INTEGER` for
  options and questions, which meant nothing bounded a request but whatever the
  transport happened to accept. It now advertises the dialect's real bounds.
- **Cancellation** is tested at both the probe and dispatch layers.

---

## 4. What a player can now do

See `docs/guides/decision-backends-setup.md` for the full walkthrough.

- **Settings → AI → Decisions** exists and is searchable.
- Configure a runtime (Ollama / external Jev-compatible / hosted Jev), an
  endpoint, a **decision checkpoint**, and a credential where relevant.
- **Test connection** runs a real sample decision through the full pipeline and
  validates the answer against the original schema.
- Readiness states are actionable and truthful: rejected credential, missing
  checkpoint, malformed output, cancellation and unreachable all read
  differently and all name what to do.
- **Save**, **reload** and **Disable** all work. Nothing is probed on load.
- Editing any field invalidates a previous green result.

Three states are kept visually and semantically apart:

| State | Proven | Permits |
|---|---|---|
| Disabled | nothing | nothing |
| Ready to test | a sample decision answered and validated | testing, shadow evaluation |
| Qualified | also cleared the frozen task gate on held-out data | not reachable in this release |

**No settings selection activates an unqualified gameplay task.** The gate is a
function (`decisionGameplayRouting`) that refuses unconditionally and names what
is missing, so the refusal is a decision the code makes rather than an absence of
code. `qualifiedForGameplay` is written as `false` on every save path.

---

## 5. The evaluator

```bash
bun run --cwd packages/frontend/ai-gateway decision:evaluate \
  --runtime=ollama --endpoint=http://127.0.0.1:11434 --checkpoint=nimble \
  --out=.evidence/381/eval.json
```

Exit codes: `0` measured pass, `1` measured fail, `2` **unavailable**, `3` usage.
There is deliberately no `--credential=<value>`; use `--credential-env=<VAR>`.

### Live run 1 — the local runtime that is actually present: UNAVAILABLE

```
$ bun run src/cli/decision_evaluate.ts --runtime=ollama \
    --endpoint=http://127.0.0.1:11434 --checkpoint=nimble \
    --out=.evidence/381/eval-ollama-0.34.3.json

task        npc-command-kind
backend     jev:ollama:http://127.0.0.1:11434/v1/systemone#nimble
status      UNAVAILABLE
reason      backend is not ready: runtime 0.34.3 is older than the 0.35.0 floor
            required by /v1/systemone (state: unsupported-runtime)
$ echo $?
2
```

Artifact: `docs/audits/evidence/381-eval-ollama-0.34.3-unavailable.json`.

**This is a measurement, and it is the honest one.** The runtime installed here
is Ollama 0.34.3, whose `/v1/systemone` route does not exist. No number was
produced, and the exit code says so.

### Live run 2 — a local `jev-v1` stub, over real HTTP: MEASURED FAIL

To prove the whole pipeline works end to end without a model, the evaluator was
run against a 20-line local HTTP server that speaks `jev-v1` and echoes the first
criteria key it is offered. **This is not a model and produces no model
measurement** — it is a transport and harness check, and it is labelled as one.

```
$ bun run src/cli/decision_evaluate.ts --runtime=jev \
    --endpoint=http://127.0.0.1:8791 --checkpoint=stub-decision \
    --out=.evidence/381/eval-stub-server.json

[heldout] attempted=44 successful=43 schemaValid=43 abstained=1
  positives=15 correct=1 positiveRecall=0.067 answeredPositiveAccuracy=0.067
  requiredAbstention=22 falseAcceptances=21 rate=0.955
  coverage=0.973 legalValueRate=1.000 excluded=7 uncomparable=0
  latency warmP50=0.10ms warmP95=0.11ms coldP95=0.13ms (cold-then-warm)
  language en: positives=15 recall=0.067 falseAcceptances=21 answered=43
gate failures:
  - positive recall 0.067 < required 0.85
  - false acceptance rate 0.955 > allowed 0.05
  - 21 command(s) fired where none was warranted > allowed 0
  - language en positive recall 0.067 < required 0.85
$ echo $?
1
```

Artifact: `docs/audits/evidence/381-eval-local-stub-measured-fail.json`.

Three things this run demonstrates, none of which is a claim about a model:

- **A `jev` runtime needs no Ollama `/api/version`.** The probe succeeded against
  an endpoint that serves no such route, and the run reached the corpus.
- **The safety gate bites.** A backend that answers "a command" for nearly every
  message is reported as 21 unsafe commands out of 22 — and it would have been
  reported as *zero* risky acceptance by the scorer this PR replaces.
- **The three outcomes are distinct.** Same command shape, same corpus, same
  gates: exit `2` for the too-old runtime, exit `1` here, exit `0` reserved for a
  real held-out pass.

Note the excluded cases: the stub answered 5 of the 7 held-out `excluded` cases,
and none of those answers moved coverage (0.973, not above 1.0) or the safety
gate. That is the third case kind doing its job.

### What would unblock qualification

1. Upgrade Ollama to **0.35.0 or later** (`ollama --version`).
2. Pull a decision checkpoint: `ollama pull nimble`.
3. Re-run the command above. Exit `0` = measured pass, `1` = measured fail,
   `2` = still unavailable, with the reason.
4. For an external backend, set `--runtime=jev` and drop the version expectation
   entirely; for a hosted one, add `--credential-env=<VAR>`.

Until a run exits `0` on held-out data, **no backend qualifies** and automatic
gameplay routing stays disabled.

---

## 6. Honest limitations

- **No model was measured.** The environment has no qualifying backend. Every
  accuracy, recall and latency figure for an actual checkpoint is absent, and
  none has been invented. The two runs above are an unavailable runtime and a
  local stub, in that order; neither is a model result.
- **The corpus has one label author.** No external multi-author consented
  player-transcript corpus was available. The eighteen shipped in-product
  openers add real distribution but not independent authorship. Recorded in the
  fixture files' `labelProvenance.limitations`, and surfaced in every artifact.
- **A pass on this corpus is necessary, not sufficient.** The probe grades a
  command kind; production routing carries payloads, ID resolution and world
  preconditions it does not exercise.
- **No bundled engine.** External and hosted endpoints work today. A managed
  bundled runtime is a documented follow-up, gated on measuring footprint,
  packaging and gameplay contention first.
- **No schemaVersion bump.** The capability and role additions are additive and
  a v3 payload written by an older build still validates, so a v3→v4 migration
  would be a no-op transform. Inventing one would have been churn.
- **`decision:evaluate` was not run against a non-Ollama endpoint** from this
  machine, because no such endpoint is reachable here. That path is covered by
  tests with an injected transport, not by a live measurement.

---

## 7. What is still missing for #381

1. A live measurement against at least one reachable backend (section 5).
2. The measured gameplay pilot — one real decision replacing real work, with
   end-to-end evidence. Out of scope here by design.
3. Independent label authorship for the corpus.
4. A managed bundled runtime, if packaging allows it, measured first.

#381 stays open until 1 and 2 are done.
