# Issue #382 — C-401 call-2 envelope extraction: schema reduction and result

**PR:** #414
**Branch:** `perf/382-envelope-extraction`
**Head at measurement:** `62ee7291e`
**Supersedes the measurement in** `382-production-path-report.md` (#413) for the
call-2 envelope only.

---

## Headline

**Removing the narrative echo did not fix the call-2 bottleneck.** The schema
reduction removes work that has no consumer and makes the contract honest, but it
is **not** the fix: on the measured configuration the extraction path still
completes **0 of 5** attempts, every one discarded at its 6 000 ms deadline — the
same 0/23 rate #413 measured before the change.

The bottleneck is the model's **reasoning channel**. A control for it exists and
is reachable from the production route — but that finding required correcting a
false premise in the previous draft of this report, so it is documented in full
under *Why it still fails* rather than asserted here.

Per the stop rule in the task brief, no timeout increase, no routing rule, no
caching, no scheduler and no prewarming were added.

---

## What changed

1. `NpcDialogueExtractionSchema` — a call-2-specific schema,
   `{ command?, choices? }`, `additionalProperties: false`, no `narrative`.
   `NpcDialogueAiEnvelopeSchema` is byte-for-byte unchanged and still exported;
   it now has **no production consumer**, so the change is additive.
2. The call-2 prompt no longer instructs the model to reproduce the narrative.
   The instruction is inverted into an explicit prohibition. The NPC persona and
   the allowed-action list are kept, because the model cannot infer a command
   without them.
3. The parser validates against the new schema. Its single "repair attempt" is
   **removed** — it existed only to re-attach a narrative the model had been
   asked to echo, so with a metadata-only schema there is nothing to repair.
   Unknown fields are now rejected outright.
4. An empty call-1 narrative is now treated as a provider failure and thrown,
   reusing the contract `generateTurn` already documents. See *Empty narrative*
   below.

No other behaviour changed: choice filtering, the command whitelist,
command-specific preconditions, final `NpcDialogueTurnSchema` validation,
cancellation, the #410 single absolute deadline, routing, model/provider
selection, privacy boundaries and deterministic fallback are all untouched.

---

## Measurement

Same model, same provider, same machine, verified field-by-field from the two
reports:

| | #413 (before) | this PR (after) |
|---|---|---|
| git SHA | `8cd5b83e` | `62ee7291e` |
| model | `ornith-1.5:9b` (9.0B, Q4_K_M) | identical |
| Ollama | 0.34.3 | identical |
| CPU | i9-14900HX, 32 cores, 31.1 GB, **no GPU** | identical |
| P1 repetitions | 3 | 5 |

Raw evidence (gitignored):
`.evidence/382-baseline/prod-path/report.json` and
`.evidence/382-baseline/envelope-fix/report.json`.

Reproduce with:

```
bun run herdr:start client
bun run --cwd apps/e2e bench:ai-baseline -- --label envelope-fix --reps 5 --sweep-samples 5 --no-contention
```

### Envelope success rate — the primary criterion, NOT met

| | before (#413) | after (this PR) |
|---|---|---|
| extraction attempts | 3 | 5 |
| extraction completed | **0** | **0** |
| extraction aborted | 3 (17 998 ms discarded) | 5 (30 001 ms discarded) |
| every duration | 5 998–6 001 ms | 5 999–6 003 ms |
| turns that degraded to narrative-only | 3/3 | 5/5 |
| turns where the outcome was observable | — | 5/5 (0 unobservable) |

Each call was cut off within 3 ms of the deadline. Nothing arrives early, and
nothing arrives malformed — the request simply never finishes.

### Completion tokens and latency

The wire cannot show what a discarded call spent, because a request aborted at
its deadline receives no body. So token counts for the extraction come from the
controlled probe below, not from the browser.

- **Narrative (call 1), on the production route:** 5/5 completed, 3 633–6 607 ms,
  1 242 completion tokens for 5 calls (~248/call). Unchanged by this PR, as
  expected — this PR does not touch call 1.
- **Extraction (call 2), on the production route:** 5/5 aborted, **0 completion
  tokens recorded** — identical to before. The fix does not move this number,
  because both before and after, the call is killed before it emits anything.

### Total turn latency and TTFT

| | before (n=3) | after (n=5) |
|---|---|---|
| turn wall clock | 11 045 / 12 935 / 11 841 ms | 10 941 / 11 183 / 12 611 / 9 638 / 10 225 ms |
| TTFT | 5 043 / 6 934 / 5 839 ms | 6 609 / 5 182 / 4 934 / 3 636 / 4 224 ms |

Unchanged in kind, and expected to be: the narrative is the same work either
way, and every turn's latency is still floored by `TTFT + ~6 000 ms` of
discarded extraction. The two runs' absolute values overlap and should not be
compared as a delta — the narrative's own duration varies run to run on this
machine by more than the change could plausibly produce.

### AI-authored vs deterministic choices

**0 of 5 turns carried a model-authored choice.** All five returned exactly the
deterministic fallback pair `["talk", "leave"]`, and all five were flagged
`extractionDegraded` (`degraded: 5, accepted: 0, unobservable: 0`).

Identification is exact, not inferred: `_deriveChoices` returns a fixed
`[{id: 'talk'}, {id: 'leave'}]`, and the probe reports the raw choice ids rather
than a pre-computed boolean, so the harness counts the pair itself. One caveat,
stated rather than hidden: a model that authored the ids `talk` and `leave`
itself would be miscounted as fallback.

### Commands and preconditions

| | result |
|---|---|
| command extracted and survived preconditions | 0/5 |
| command extracted but denied by preconditions | 0/5 |
| preconditions evaluated at all | 0/5 |

The precondition path is **untested by this measurement** — it never received a
command. It is covered by unit tests instead: a valid command still flows
through (`offerQuest`), and a command the NPC may not issue is still dropped
(`giveItem` on a non-vendor) while the narrative renders.

### Empty narrative

`NpcDialogueTurnSchema.narrative` is `Type.String()` with no `minLength`, so `''`
validates. Before this change an empty call 1 could be backfilled by the
envelope's narrative; now it cannot, and without a guard an empty response would
have been reported as a successful `source: 'ai'` turn carrying fallback choices
— a provider that said nothing, presented as a working one.

So the invariant is explicit: **a turn with an empty (or whitespace-only)
narrative is not a successful turn.** It throws, and `generateTurn` maps a
non-abort, non-timeout error to `{kind: 'failed', reason: 'provider_error'}`.
That is the behaviour `generateTurn` already documents for a provider failure
("the error is surfaced, never faked with authored dialogue") — this reuses an
existing contract rather than inventing player-facing behaviour. The check runs
**before** call 2, since a turn with no narrative can never succeed and the
extraction would be spent for nothing. No length threshold was introduced: short
replies are legitimate, whitespace is not a reply.

Covered by two tests: empty narrative, and whitespace-only narrative. Both assert
`rejects` plus `reason: 'provider_error'`; the empty case also asserts call 2 is
never issued.

---

## Why it still fails: the reasoning channel

The wire log cannot answer this — an aborted request has no body to read token
counts from. `apps/e2e/scripts/ai_envelope_thinking_probe.ts` therefore asks the
provider directly.

```
bun run --cwd apps/e2e probe:ai-envelope-thinking
```

### 🔴 Correction: the production route is native `/api/chat`, not `/v1`

An earlier draft of this section stated that the client talks to Ollama through
`/v1/chat/completions`, and drew from it the conclusion that "`think: false` is
accepted but ignored on the route the client uses, so it is not a fix".

**That premise was wrong, and the conclusion built on it does not hold.** Three
independent checks agree:

1. `resolveChatUrl` in
   `packages/frontend/ai-gateway/src/lib/text_adapter_openai_compatible.ts`
   routes `resolution.provider === 'ollama'` to `${base}/api/chat`, stripping
   any stored `/v1` suffix. Only other providers reach
   `${base}/chat/completions`.
2. Every wire call captured by the two production benchmarks went to
   `http://localhost:11434/api/chat` — 97/97 in `prod-path`, 43/43 in
   `envelope-fix` — even though the connection is configured with the endpoint
   `http://localhost:11434/v1`.
3. `/v1/chat/completions` is reachable in this repo from exactly three places:
   the dev-only chat view bypass, the Settings *provider test* URL, and this
   probe. None of them is the dialogue path.

So `think: false` is not "a fix for a surface the client does not speak to". It
is a fix for **the** surface the client speaks to, and the measurements below
show it working there.

A second, smaller error came from the same place: the probe was sending
`options: { num_predict: 800, temperature: 0.3 }`, because
`buildGenerationParams` returns `{}` for Ollama — so the production `/api/chat`
body carries **no** `options` at all. The 800-token cap in the runs below is an
artefact of the probe, not a production constraint, and the probe was
reproducibly measuring a different request than the one that fails. The probe
now sends the production body.

### Measured reasoning control, per surface

Every variant repeated, because with reasoning on this model's output length
varies by more than 3× between identical calls. Raw evidence:
`.evidence/382-baseline/envelope-thinking/` (`sweep-reps3.json`,
`highrep-native-thinkfalse.json`,
`highrep-v1-reasoning-effort-none.json`).

| variant | n | within 6 000 ms | schema-valid | median ms | max ms | median completion tok | reasoning chars |
|---|---|---|---|---|---|---|---|
| **`/api/chat`, production body (the real route)** | 3 | **0** | 2 (late) | 31 355 | 36 524 | 1 572 | 7 311 |
| **`/api/chat` + `think: false`** | 8 | **8** | **8** | 2 412 | 5 085 | 121 | **0** |
| `/api/chat` + `reasoning_effort: "none"` | 3 | 0 | 2 | 14 626 | 34 899 | 766 | 6 948 |
| `/api/chat`, legacy envelope prompt (pre-#414) | 3 | 0 | 2 (late) | 19 208 | 35 455 | 971 | 7 101 |
| `/v1` default | 3 | 0 | 1 | 15 501 | 15 533 | 800 (cap) | 3 238 |
| `/v1` + `think: false` | 3 | 0 | 1 | 15 613 | 16 082 | 800 (cap) | 3 180 |
| `/v1` + `reasoning_effort: "none"` | 8 | **8** | 6 | 2 498 | 5 090 | 126 | **0** |
| `/v1` + `reasoning_effort: "minimal"` | 3 | 0 | 0 | 15 621 | 15 695 | 800 (cap) | 3 463 |
| `/v1` + `chat_template_kwargs.enable_thinking: false` | 3 | 0 | 0 | 15 511 | 15 597 | 800 (cap) | 3 460 |

**What the installed Ollama 0.34.3 actually supports** (measured, not assumed,
and not taken from a review comment):

- `think: false` on native `/api/chat` — **honoured.** 0 reasoning characters,
  every answer inside the budget.
- `think: false` on `/v1/chat/completions` — **accepted and ignored.**
- `reasoning_effort: "none"` on `/v1/chat/completions` — **honoured.** The
  review claim that Ollama maps it to `Think=false` is correct, verified
  independently here at n=11 across two runs.
- `reasoning_effort: "none"` on native `/api/chat` — **accepted and ignored.**
- `reasoning_effort: "minimal"` — **not** a "lower it" dial. It leaves
  reasoning fully on: 3 463 reasoning characters, every call over budget. Only
  the exact value `none` switches the channel off.
- `chat_template_kwargs: { enable_thinking: false }` — **not forwarded.** The
  model's own template *does* branch on `enable_thinking` (visible in
  `/api/show`), but `/v1` does not pass the field through.

The lesson worth keeping: **a 200 response is not a honoured field.** Ollama
accepts all six spellings without error and honours exactly two of them, and
the two it honours are not the two a reader would guess. Any claim that a
provider "supports" a control has to be re-measured against the installed
version.

### The diagnosis, stated correctly

1. **The shipped extraction never completes inside the budget on the production
   route** — 0/3 with reasoning on, and 0/5 in each of the two production
   benchmarks. Not in doubt.
2. **The reasoning channel is what the budget is spent on.** The model's
   answer is 67–265 completion tokens; with reasoning on, the same requests
   spend 1 500+ median completion tokens and 7 000 reasoning characters, and
   miss the deadline every time. `maxTokens` is not the constraint either — the
   model was never trying to fill it.
3. **A control exists, and it is reachable from production.** `think: false` on
   the native route is 8/8 within budget and 8/8 schema-valid, median 2.4 s.
   This is the answer to the question the previous draft called unanswerable.

### What the schema reduction did and did not achieve

**Did:** remove work that has no consumer. The model no longer emits a narrative
the client already holds, so the output is smaller in principle, the client no
longer needs a repair path, and the contract is now honest about what call 2 is
for. Prompt tokens are stably lower: 2 233–2 235 against the legacy 2 276.

**Did not:** measurably speed up the path. With reasoning on, both schemas
miss the deadline and the run-to-run reasoning length swamps the difference
(31 355 ms for the shipped schema, 19 208 ms for the legacy one, with the
ordering reversing between runs). The reduction is retained because it is
correct and strictly reduces the work requested, not because it was shown to be
the fix. It was tested as the fix and it is not the fix.

### Can the extraction be reduced further, without losing correctness?

No, not meaningfully. With reasoning off the answer is 67–265 completion tokens
— `{"choices": [...]}` with at most four entries, plus a command where the
narrative implied one. There is no output left to remove. Prompt size is not the
constraint either: ~2 235 prompt tokens are a small fraction of the 2.4 s
median. What remains is reasoning, not schema, not prompt, and not budget.

---

## Behaviour that is unchanged and verified

- Choice filtering (`_filterChoices`), command whitelist
  (`_validateCommandPreconditions`), and final `NpcDialogueTurnSchema`
  validation are byte-identical. The malformed-extraction path still degrades to
  the streamed narrative (AC-7) and never discards text the player has read.
- Absolute-deadline semantics from #410 are untouched. `budgetMs: 6_000` is
  unchanged in `packages/shared/constants/src/lib/text_task.ts`. No timeout was
  raised.
- Cancellation: abort during call 2 still rejects, and no partial turn is
  written. The empty-narrative check runs before call 2, so it cannot mask an
  abort that happens later.
- Routing, model/provider selection and privacy boundaries are untouched.
- Deterministic fallback is unchanged: on extraction failure the player gets
  derived choices, exactly as before.

---

## Test coverage added

`apps/frontend/client/src/lib/services/game/npc_dialogue_extraction.test.ts`
(12 integration tests) and the `NpcDialogueExtractionSchema` block in
`packages/shared/schemas/src/lib/game/npc_dialogue_command.test.ts` (6 schema
tests, including an explicit compatibility guard that the legacy envelope still
requires a narrative).

Integration: call 2 uses the extraction schema and never asks for a narrative;
the prompt no longer instructs reproduction while retaining NPC context and
allowed actions; model-authored choices survive validation; extraction with
neither command nor choices is a valid successful turn; a valid command flows
through preconditions; a precondition-denied command is dropped while the
narrative renders; an extraction that *returns* a narrative is malformed and
degrades; malformed extraction degrades; extraction timeout degrades; empty
narrative and whitespace-only narrative both surface as `provider_error` without
issuing call 2; abort during call 2 rejects.

Four existing tests encoded the old contract and were updated deliberately, not
silently: three mocks returned `structured: { narrative: … }`, which the new
schema correctly rejects, and one pinned the removed repair attempt. The
"unknown extraction fields are rejected outright, with no repair attempt" test
documents that the old repair path is gone and that an injected field cannot
smuggle a command through.

---

## Verification (each command confirmed to execute)

| command | result |
|---|---|
| `bun moon run client:typecheck --force` | 0 errors, 0 warnings |
| `bun moon run e2e:typecheck --force` | clean |
| `bun moon run schemas:test --force` | 913 pass, 0 fail |
| `bun moon run types:typecheck --force` | clean |
| `bun moon run client:test --force` | 4 344 pass, 0 fail, 4 347 tests across 330 files |
| `bun run scripts/src/lib/ops/run_guards.ts` | 10/10 guards pass |
| `bun run lint` | clean on all changed files |

`--force` is used throughout because Moon has been observed printing a cached
no-op typecheck. Collection of the new test file was **proved** rather than
assumed: a deliberately failing sentinel test in it turned the suite red
(`4344 pass, 1 fail`) and was then reverted — Bun only prints per-test lines on
failure, so a green run's silence about the new file proves nothing.

The pre-commit hook was not relied on as evidence, and is not fixed here
(separate tooling follow-up). Its `moon run :typecheck --affected` is still
susceptible to the same cache behaviour.

`guard_source_file_size` required the extraction prompt/parser and the new tests
to move into their own modules; both baselined files **shrank** (service
2 895 → 2 854, test 2 657 → 2 474) and the reduction was locked in with
`--update-baseline`, which is reduction-only. No ceiling was raised.

---

## Harness changes (measurement only)

- P1 now reports a `byCall` split. The two C-401 calls are distinguished by
  whether the request body carries a schema constraint — **not** by `streamed`,
  which is unreliable exactly where it matters: an aborted request never reaches
  the response handler and is recorded with `streamed: false` regardless of how
  it was issued. The check needs two markers, because the gateway sends neither
  `format` nor `response_format` to Ollama (it documents that the local provider
  ignores them), so on this route the schema's only trace is the gateway's own
  schema instruction inside the system messages. An earlier attempt using
  `streamed` classified all 10 requests as extractions; it was corrected, not
  reported.
- P1 now reports an `extractionOutcome` block that counts the extraction result
  over **observed** turns only. The probe reads the service's own `warn` output
  and yields `undefined` — never `false` — when that is not observable, so a
  stubbed turn cannot be counted as a successful extraction. `unobservable` is
  reported beside the counts; it is 0 in the run above.
- The turn probe reports `choiceIds`, `commandExtracted`, `extractionDegraded`
  and `commandDenied`, so "the model produced this" is distinguishable from "the
  client fell back". `warn` is restored in a `finally`.
- `--no-contention` runs P1 without P2. P2 saturates the provider, and because
  the report is written once at the end, a P2 failure discarded P1's
  measurements entirely. The contention A/B is deliberately **not** rerun here —
  it is the next step, at burst widths 1/2/4 NPCs.

### Environment notes for anyone reproducing this

Two local-environment problems cost time and are recorded so they are not
rediscovered as if they were findings:

1. **The model had to be re-pulled.** The Ollama model store was empty after a
   machine restart, so `ollama pull ornith-1.5:9b` (6.55 GB) was needed. An empty
   store fails with `The text provider is not reachable at …/v1/models`, which
   reads like a configuration fault rather than a missing model.
2. **The local asset origin could not serve the Emberwatch pack.**
   `local_asset_origin.ts --published-only` builds 12 729 rows but contains no
   Emberwatch manifest, and `.env.emulator.local` points `PUBLIC_ASSETS_BASE_URL`
   at it. The result is a 404 on `/emberwatch/manifest.json`, a
   `boot:stage-failed {stage: preloading_content}` and a page that never installs
   the benchmark seam — which surfaces as the harness's
   `waitForFunction: Timeout 90000ms exceeded`, i.e. as if the seam code were
   broken. For this measurement the gitignored `.env.emulator.local` was moved
   aside so the client resolved assets from the upstream host. **That file has
   not been restored yet** and must be, once a local origin that actually
   carries the pack exists. It is bootstrap-generated local state, not tracked,
   so it is not part of this PR.

---

## Smallest next step (answered; implementation is a separate PR)

**The question is settled, and the answer is that no new mechanism is needed.**
`think: false` on the native `/api/chat` route the client already uses is
honoured by the installed Ollama 0.34.3, and it is the only thing that has to
change. The four candidate mechanisms in the previous draft of this section are
all unnecessary:

1. `reasoning_effort: "none"` on `/v1` — works (n=11), but `/v1` is not the
   dialogue route, so it is the answer to a question nobody asked;
2. `/api/set` or a model-level parameter — unnecessary, the request field is
   honoured;
3. a chat-template parameter forwarded through `/v1` — measured, not forwarded;
4. a different non-reasoning model — unnecessary, and it would be a routing and
   quality decision with a mandatory download. Rejected on the evidence, not
   on taste.

What the change should look like is deliberately small, because the mistake a
general reasoning framework invites is a silent change to player-facing prose:

- a **semantic** preference (`reasoning: 'none'`) on the *task preset*, set on
  `envelope` only — `dialogue` and `narration` keep the provider default;
- an **optional** connection-level override in `TextParams.reasoning`, which
  wins over the task, so explicit user configuration is never overrules;
- an **additive provider capability** declaring which spelling a provider
  actually honours, absent for every unmeasured provider;
- the **adapter** as the only place that knows a spelling, translating the
  preference into `think: false` or `reasoning_effort: "none"` and emitting
  nothing at all when the provider declares no control.

The gate is the measurement this report already provides: a schema-valid
answer inside the unchanged 6 000 ms budget on the production route, with the
narrative provably untouched. Raising `budgetMs` remains off the table — the
request fits the existing budget with the channel off, so there is nothing to
buy.

## #382 status

Issue #382 stays **open**. Contention scheduling, prewarming, context
compression and provider caching are untouched and still outstanding. The
call-2 envelope is now *correct* and, with reasoning control, *fast* — but the
reasoning-control implementation is deliberately not in this PR.
