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

The bottleneck is not the output the schema asked for. It is the model's
**reasoning channel**, and on the route the client actually uses there is no
measured way to turn that channel off.

Per the stop rule in the task brief, no timeout increase, no routing rule, no
caching, no scheduler and no prewarming were added. The smallest next step is
proposed at the end and is **not** implemented here.

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
provider directly, reproducing the production request exactly (same schemas,
same prompts, same `maxTokens: 800`, and the same absence of `format`, because
the gateway deliberately sends no `response_format` to Ollama).

```
bun run --cwd apps/e2e probe:ai-envelope-thinking
```

Two runs, both preserved at
`.evidence/382-baseline/envelope-thinking/both-runs.json`:

| probe | surface | run 1 | run 2 |
|---|---|---|---|
| extraction schema (as shipped) | native `/api/chat` | 9 716 ms / 247 tok / 849 reasoning chars / **no budget** | 18 944 ms / 800 tok (capped) / 3 498 chars / **no budget** |
| legacy envelope (pre-PR) | native `/api/chat` | 17 534 ms / 460 tok / 1 035 chars / **no budget** | 14 691 ms / 800 tok (capped) / 3 311 chars / **no budget** |
| extraction schema, `think: false` | native `/api/chat` | **4 396 ms / 122 tok / 0 chars / budget met** | **3 377 ms / 186 tok / 0 chars / budget met** |
| extraction, default | `/v1` (the client's route) | 29 056 ms / 800 tok / empty / **no budget** | 13 827 ms / 800 tok / empty / **no budget** |
| extraction, `think: false` | `/v1` (the client's route) | 28 289 ms / 800 tok / truncated / **no budget** | 19 858 ms / 800 tok / empty / **no budget** |

**Stable across both runs:**

1. **The shipped extraction never completes inside the budget on either
   surface** — 4/4 probes over, every time. This is the finding that matters and
   it is not in doubt.
2. **Reasoning tokens are what the budget is spent on.** Disabling the channel
   takes the same request from "over budget, no answer" to **3 377–4 396 ms with
   a valid JSON answer**, using 122–186 completion tokens. 122–186 tokens is under
   a quarter of the 800-token allowance, so **`maxTokens` is not the constraint
   either**; the model was never trying to use it.
3. **`think: false` does not work on the route the client uses.** `/v1` accepts
   it without error and then ignores it: completion still hits the 800-token cap
   and the answer comes back empty or truncated at `{"choices":[`. So "send
   `think: false`" is not a fix — it is a fix for a surface the client does not
   speak to. Any next step must first find a control this route honours.

**Not stable, and therefore not claimed:** with reasoning enabled the model's
output length varies by more than 3× between otherwise identical calls (247 then
800 completion tokens; reasoning 849 then 3 498 characters), and the ordering
between the two schemas **reversed** between runs (shipped 9 716 ms vs legacy
17 534 ms, then shipped 18 944 ms vs legacy 14 691 ms). A single run therefore
cannot support any claim that the reduced schema is faster. An earlier draft of
this report did claim roughly half the work, on the strength of run 1 alone; that
claim is withdrawn. See *What the schema reduction did and did not achieve*.

### What the schema reduction did and did not achieve

**Did:** remove work that has no consumer. The model no longer emits a narrative
the client already holds, so the output is smaller in principle, the client no
longer needs a repair path, and the contract is now honest about what call 2 is
for. Prompt tokens are stably lower: 2 233–2 235 against the legacy 2 276.

**Did not:** measurably speed up the path. Both schemas reach the 800-token cap
and both miss the deadline; run-to-run reasoning length swamps the difference.
The reduction is retained because it is correct and strictly reduces the work
requested, not because it was shown to be the fix. It was tested as the fix and
it is not the fix.

### Can the extraction be reduced further, without losing correctness?

No, not meaningfully. With reasoning off the answer is 122–186 completion tokens
— `{"choices": [...]}` with at most two entries, and no command where the
narrative implied none. There is no output left to remove. Prompt size is not the
constraint either: 2 233 prompt tokens are a small fraction of the 3 377–4 396 ms
total. What remains is reasoning, not schema, not prompt, and not budget.

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

## Smallest next step (proposed, not implemented)

**Establish whether the reasoning channel can be disabled through `/v1`.** This
is one falsifiable question and it gates everything else. Three candidate
mechanisms, none of them assumed to work:

1. Ollama's `/api/set` or model-level parameter for the reasoning channel,
   applied once at load;
2. a chat-template parameter carried on the request in a form `/v1` forwards;
3. a different (non-reasoning) model for the `envelope` task — which would be a
   routing change, and therefore its own hypothesis with its own evidence.

The gate for all three is the same measurement the probe already provides: an
extraction that completes inside 6 000 ms **on `/v1`**, with the streamed
narrative unchanged. Raising `budgetMs` is not among the candidates, because
122–186 completion tokens at the observed 35–38 ms/token is ~3.4–4.4 s — the
request already fits the existing budget once reasoning is off. If no mechanism
exists, that is itself the finding, and the honest conclusion becomes that a
reasoning model is the wrong tool for a 122-token structured extraction.

## #382 status

Issue #382 stays **open**. Of its acceptance criteria, the call-2 envelope work
is now *correct but not yet fast*: the schema no longer asks for work it does not
need, and the remaining failure is characterised and attributed. Contention
scheduling, prewarming, context compression and provider caching are untouched
and still outstanding.
