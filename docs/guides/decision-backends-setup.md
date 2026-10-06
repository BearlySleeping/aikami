# Decision backends: setup → sample → qualification

Issue #381. This is the player-facing and operator-facing companion to
**Settings → Decisions / System One**, plus the exact commands to run the
evaluator yourself.

It is written for a reader who has been told "Jev / System One decision models"
and wants to know what to install, what to type, and what the words on screen
actually mean.

---

## 1. What this is, in one paragraph

A *decision backend* answers **bounded, closed questions**: "of these seven
options, which one does this text imply?" It does not write prose. It is used
for narrow mechanical judgements that a large language model is a poor and
expensive fit for.

It is **optional**. The game plays exactly the same with no decision backend
configured, and nothing in the game is routed to one automatically in this
release. Configuring a backend lets you *test* and *evaluate* it. It does not
change gameplay.

---

## 2. The three states, and why they are not the same thing

These appear on the section header and they mean different things. The
distinction is the whole design:

| State | Badge | What has actually been proven | What it permits |
|---|---|---|---|
| **Disabled** | `○ Disabled` | Nothing | Nothing is probed or routed |
| **Ready to test** | `◐ Ready to test` | A real sample decision came back and passed schema validation | Testing, shadow evaluation |
| **Qualified for automatic tasks** | `● Qualified` | Also cleared the frozen task-quality gate on held-out data | *(Not reachable in this release)* |

"Ready to test" is **not** "qualified". A sample inference proves the backend can
answer *at all*; it says nothing about whether the answer is *right*. Treating
one as the other is how a decision backend ends up firing real game commands
from a model that was never measured.

**No settings selection can move a backend into the qualified state.** Only a
measurement against the frozen held-out corpus can, and this release ships no
shipped measurement.

---

## 3. Pick a runtime

The section offers three backends. All three serve the same wire dialect
(`jev-v1`) and none of them is installed for you — Aikami never downloads or
upgrades a runtime on your machine.

### 3.1 Ollama (local) — reuse a daemon you already run

If you already run Ollama for narration, the same daemon can serve decisions.

- **Requires Ollama 0.35.0 or later.** `/v1/systemone` does not exist before
  that. Ollama's `/api/version` answering 200 is *not* enough — 0.34.x answers
  200 on the version route and 404 on the decision route, which is exactly the
  false-ready case this feature was built to avoid.
- **Requires a decision checkpoint.** `llama3` is a chat model. It is not a
  decision model and will not be accepted here, even though it lives on the same
  server.

```bash
ollama --version                 # must report >= 0.35.0
ollama pull nimble               # or a Tev1 variant; see the vendor docs below
curl -s http://127.0.0.1:11434/api/version
```

### 3.2 Jev-compatible server (local) — bring your own runtime

Any server that serves the `jev-v1` body. Laya is the documented one with an
HTTP serving mode; there is no bundled engine, and nothing here requires one.

```bash
# whatever your server's own start command is, then:
curl -s http://127.0.0.1:8080/v1/models
curl -s -X POST http://127.0.0.1:8080/v1/systemone \
  -H 'Content-Type: application/json' \
  -d '{"model":"<checkpoint>","state":"A maintenance task has not finished.","questions":{"q":{"type":"choice","instructions":"Should it continue?","criteria":{"no":"It should stop.","yes":"It may continue."}}}}'
```

A `jev` runtime is **never** asked for `/api/version`, and it never has to serve
one. That is a deliberate separation: "speaks this dialect" and "is this
runtime" are different facts, and requiring Ollama's version route is what made
external decision servers unusable.

### 3.3 Hosted Jev

A hosted decision endpoint. Requires an API key. Only the question leaves your
machine; the key is stored in the local encrypted vault and sent only to the
endpoint you typed.

---

## 4. Configure it in the app

1. Open **Settings → AI → Decisions**.
2. Choose the backend, paste the endpoint, and enter the **decision checkpoint**.
   The checkpoint is required and is deliberately a separate field from the chat
   model — reusing your narration model here is the mistake this form exists to
   prevent.
3. Enter an API key if the backend asks for one.
4. **Save.** Saving writes the configuration and nothing else. It does not
   probe, and it does not mark the backend ready.
5. **Test connection.** This runs a *real sample decision*: the full pipeline,
   including schema reconstruction and validation. A bound port and a model list
   are not a test.
6. **Disable** turns it off and persists that.

Reloading restores exactly what you saved. Editing any field invalidates a
previous green result, because a green badge describing the old configuration is
worse than no badge.

---

## 5. Read the readiness message honestly

Every readiness state maps to an actionable sentence:

| State | What it means | What to do |
|---|---|---|
| `ready` | Sample decision answered and validated | Nothing; test more if you want |
| `unsupported-runtime` | Runtime older than the dialect floor | Upgrade it **yourself** — Aikami never upgrades a shared daemon |
| `model-missing` | Runtime fine, checkpoint absent | Pull the checkpoint, test again |
| `capability-missing` | Checkpoint present, no decision scoring advertised | Pick a decision checkpoint |
| `incompatible-dialect` | Endpoint speaks a different dialect | Use a `jev-v1` endpoint |
| `oversize` | Sample did not fit the backend's declared limits | Report the limits |
| `sample-rejected` | Answered, but not a legal value | Nothing was applied; treat the checkpoint as unusable |
| `unreachable` | No answer | Check the URL and that the server is running |
| `unauthorized` | Credential refused | Re-enter the API key |
| `deadline-exceeded` | No answer in time | A cold first call can exceed this; try again |
| `cancelled` | Test cancelled | — |
| `misconfigured` | Runtime and endpoint disagree | Fix the runtime or the endpoint |

The endpoint shown is always redacted: a credential pasted into the URL is
stripped before it can reach the screen, a log or a report.

---

## 6. Run the evaluator yourself

From the repository:

```bash
bun install
bun run --cwd packages/frontend/ai-gateway decision:evaluate \
  --runtime=ollama \
  --endpoint=http://127.0.0.1:11434 \
  --checkpoint=nimble \
  --out=.evidence/381/eval-<name>.json
```

For an external or hosted backend:

```bash
AIKAMI_JEV_TOKEN=... bun run --cwd packages/frontend/ai-gateway decision:evaluate \
  --runtime=jev \
  --endpoint=https://jev.example.com \
  --checkpoint=jev-hosted-1 \
  --credential-env=AIKAMI_JEV_TOKEN \
  --out=.evidence/381/eval-hosted.json
```

There is deliberately **no `--credential=<value>` flag**. A secret in `argv`
lands in shell history, in `ps`, and in any CI log that echoes the command. The
secret is read from an environment variable whose *name* you pass.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | **Measured pass.** Every frozen gate held on the held-out split. |
| `1` | **Measured fail.** The backend answered and did not meet a gate. |
| `2` | **Unavailable.** No number could be produced; the artifact says why. |
| `3` | Usage error. |

An unavailable backend is **not** a pass and **not** a fail. Collapsing the three
is how an unmeasured feature comes to be described as a validated one.

### What it reports

Per split: attempted, successful, schema-valid, abstained, positives, correct,
**positive recall** (the gate), answered-positive accuracy (a diagnostic),
required-abstention cases, **false acceptances** and their rate (the safety
gate), coverage, legal-value rate, excluded cases, and latency with cold/warm
split by dispatch order. Then per-language and per-category slices, per-case
outcomes, the frozen gates the run was judged against, and the corpus's own
stated limitations.

Cold samples are the first N dispatches of a freshly started process, model load
included. Warm follows a fixed number of unmeasured warm-up dispatches. A
percentile is withheld below 20 labelled samples rather than rounded off three.

---

## 7. Benchmark candidates, do not pick from a table

The evaluation is the comparison. Vendor throughput figures are not.

- **Ollama Nimble / Tev1** — same daemon as your chat model. The open question
  is whether residency and VRAM contention erase the classifier's advantage
  when the narrative model is loaded too.
- **Laya (local)** — smaller encoder-style inference over HTTP or JS/ONNX. The
  open question is whether the selected checkpoint understands *this* task and
  whether it fits without blocking frames.
- **Hosted Jev** — the comparison without local residency. The open questions
  are network latency, credential handling, and actual price.

Run the evaluator against each and compare the artifacts. The gate that matters
first is not latency — it is **false acceptance on the held-out split**, because
that number is real state changes fired at real NPCs.

---

## 8. What this does NOT do, stated plainly

- **It does not route gameplay.** Nothing in the game calls a decision backend.
  The automatic-gameplay gate refuses unconditionally in this release, and the
  section says so on screen.
- **It does not qualify a workload.** `npc-command-kind` is a *research probe* on
  a command-kind discriminator. Production commands carry `itemId`, `quantity`,
  `questId`, `skill` and `difficultyClass`, and are gated by world preconditions
  the probe does not exercise. A pass on this corpus is necessary, not
  sufficient.
- **It does not bundle an engine.** No new runtime is installed or packaged
  here. External and hosted endpoints work today; a managed bundled runtime is a
  separate follow-up once footprint, packaging and gameplay contention have been
  measured.
- **It does not use a multi-author consented transcript corpus.** None was
  available. Labels are one contract author's, plus the shipped in-product
  player-facing openers taken verbatim. Recorded in the fixture files, not just
  here.
- **It does not fix the production mutation path.** That is the next lane.

---

## 9. Upstream references

These are candidates to measure, not a ranking:

- Ollama System One / Jev-style decision models:
  <https://ollama.com/blog/ollama-now-supports-jev-style-decision-models>
- Laya serving and checkpoints: <https://github.com/NandhaKishorM/laya>
- Hosted Jev: <https://typesafe.ai/blog/introducing-system-one-models-and-jev>
