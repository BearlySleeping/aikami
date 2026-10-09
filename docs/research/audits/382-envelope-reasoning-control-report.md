# Issue #382 — C-401 call-2 envelope: reasoning control

**PR:** #415
**Branch:** `perf/382-envelope-reasoning`
**Base:** `main` (rebased onto #414's merge, `5fe6bcf3b`)

---

## Headline

Turning the reasoning channel off for the `envelope` task — and only for that
task — takes call-2 extraction from **0 of 33 completed** to **19 of 20**, all
inside the **unchanged** 6 000 ms budget, and gives the player model-authored
choices and live command/precondition evaluation instead of the deterministic
`["talk", "leave"]` pair on every turn.

| | before | after |
|---|---|---|
| extraction transport-completed | **0/33** (0/23 #413, 0/5 #414, 0/5 pre-merge) | **19/20** |
| extraction aborted at the 6 000 ms budget | 33 | **1/20** |
| completed-extraction latency | never observed — cut off at 5 994–6 001 ms | **2 374–5 814 ms**, median 4 550 |
| completion tokens per extraction | 0 recorded (cut off before emitting) | 109–281, median 214 |
| turns with AI-authored choices | **0/33** | **16/20** |
| turns with deterministic fallback choices | 33/33 | 4/20 |
| commands reaching precondition evaluation | **0/33** | 6 command occurrences denied, 3 top-level accepted |
| `budgetMs` for `envelope` | 6 000 | **6 000 — unchanged** |

The 6 000 ms budget was not raised. The request now fits it, so there was
nothing to buy by raising it.

**Scope of the claim.** Every number here is from ONE configuration: Ollama
0.34.3, `ornith-1.5:9b` (Q4_K_M), CPU-only on an i9-14900HX / 32 cores /
31.1 GB. It is a demonstration that the bottleneck is real, attributable, and
removable on a realistic local setup — not a claim of universal reliability
across hardware, models or providers. A machine half this size, or a model
with a longer reasoning habit, will not reproduce 4 550 ms.

**Transport success is not gameplay success.** 19/20 means the provider call
returned. Four turns still degraded to deterministic choices: one because the
call hit the deadline, three because the model returned a payload the schema
rejects. Those are counted separately below, because "19/20 completed" is not
"19/20 successful AI choices" and should never be quoted as one.

---

## The problem, stated correctly

`envelope` is a **bounded metadata extraction**. Call 1 has already streamed the
narrative; the client already treats it as authoritative; call 2's entire output
is a short JSON object — `{"choices": [...]}`, optionally `{"command": {...}}`
— whose answer is 109–281 tokens.

Measured on the local configuration, the same request with the model's
reasoning channel at its default spent **1 500+ median completion tokens and
7 000+ reasoning characters** and missed the 6 000 ms deadline every single
time. The reasoning is not producing anything the consumer reads; it is
consuming the entire budget.

The previous report framed this as "no reasoning control exists on the route the
client uses". That was wrong. The client uses Ollama's **native `/api/chat`**,
where `think: false` is honoured. See the correction in the #414 report; the
measured matrix, per surface and per spelling, is there.

---

## The change

Four small edits, each owned by the layer that already owns that decision.

1. **A semantic preference, not a wire field.** `AiReasoningSchema` =
   `'default' | 'none'`. The tasks say *what they want*; nothing outside the
   adapter knows a provider's spelling.

2. **A task property.** `TextTaskPreset.reasoning`, set to `'none'` on
   **`envelope` only**. `dialogue`, `narration`, `combat-narration` and
   `combat-ai` are untouched and keep the provider default — asserted by test,
   because that failure mode (silently turning reasoning off for player-facing
   prose) would be invisible to every benchmark in this issue.

3. **It rides on the per-call resolution, not the connection.**
   `AiModeResolution.reasoning`, set once in `_toTextResolution` from the task.
   Absent means "provider default", and absent is what every other task gets.

4. **An additive, surface-qualified provider capability.**
   `ProviderDescriptor.reasoningControl` names the (provider, **surface**)
   pairing that was actually measured. Only `ollama` declares one
   (`'ollama-native-think'`). Every other provider, including unknown ids,
   returns `undefined`.

5. **One module owns the spelling and the surface.**
   `reasoning_control.ts` holds `resolveChatSurface` and
   `buildReasoningParams`. `resolveChatUrl` branches on the same
   `resolveChatSurface`, so the URL and the reasoning spelling cannot disagree
   about the transport, and a control measured on one surface is **dropped** on
   the other rather than sent.

### A design that was tried and removed

The first version of this PR put the preference on the persisted connection
(`TextParams.reasoning`) with the precedence
`connection.reasoning ?? taskPreset.reasoning`. It was removed, because an
audit of every construction, persistence, migration and settings path found:

- **no UI can set it.** The generation-params editor
  (`ai_connection_modals.svelte`) edits seven numeric fields by name, and
  `setGenParamField` is typed `(field: keyof TextParams, value: number)`. The
  built-in presets (`BUILT_IN_PRESETS`) are seven-key literals. `git grep
  reasoning` across `views/` returns nothing. The only way to set it was
  hand-editing stored JSON.
- **so its only reachable effect was to switch the fix back off.** A stored
  `reasoning: 'default'` would re-enable reasoning for `envelope` and restore
  the 6 000 ms stall, for a user who had configured nothing and could not see
  why.
- **it added a key to a versioned, migrated storage format** for no benefit,
  and widened `keyof TextParams` with a string-valued member, opening a type
  hole in a numeric-only setter.
- **the vault is loaded as a bare cast** (`JSON.parse` → `as AiConnection[]`,
  no `Value.Parse` / `Clean` / defaults), so nothing *would* have materialised
  `'default'` — the invariant did hold. But holding by accident, on a field no
  user can reach, is not a design worth keeping.

The legacy `_paramsFromLegacy` path rebuilds text params field-by-field and
would have **dropped** the value — another reason the field did not belong
there. It is now not on `TextParams` at all, so there is nothing to drop.

The preference is a property of the call, and the call is the only thing that
knows which task asked.

### Questions this design answers

| question | answer |
|---|---|
| task property, provider capability, connection setting, or a combination? | **Task property + provider capability.** A connection setting was tried and removed: it is unreachable, and its only effect was to disable the fix. |
| semantic intent or provider wire field? | **Semantic** (`reasoning: 'none'`). The alternative would put `think: false` into game code. |
| which adapter translates it? | `reasoning_control.ts` — one module, injected via `getReasoningControl`, so the gateway package keeps no dependency on the provider registry. |
| provider does not support it? | Field omitted, request byte-identical, task degrades on its own deadline. Never a failed call. |
| provider supports it on a *different* surface? | Field omitted. This is the surface guard, and it is why `reasoningControl` is surface-qualified. |
| must explicit user config take precedence? | **There is no user config to overrule.** The task preset *is* the configuration, and no stored value can reach the wire — asserted by a test that feeds a `reasoning` key through `params` and checks the body. |
| could this affect player-facing narrative? | **No.** Only `envelope` sets it; asserted by test; and confirmed by production measurement. |
| could it change routing or cloud spend? | **No.** No provider or model is selected, moved or added. The field only reaches a provider already being called, on a surface already being used. |

### What was deliberately not done

No reasoning framework, no global switch, no per-provider heuristic, no model
change, no mandatory download, no timeout increase, no concurrency change, no
routing change, no connection-level setting. `envelope` is the one measured
case, and widening the list requires its own measurement.

---

## Measurement

### Before — baseline at the pre-merge head

```
bun run herdr:start client
bun run --cwd apps/e2e bench:ai-baseline -- --label 382-before-reasoning --reps 5 --sweep-samples 5 --no-contention
```

| | before |
|---|---|
| attempts | 5 |
| transport completed | **0** |
| aborted at the deadline | 5 (29 995 ms discarded) |
| every duration | 5 994–6 001 ms, then killed |
| turns degraded to narrative-only | 5/5 |
| turns accepting an extraction | 0/5 |
| AI-authored choices | 0 |
| deterministic fallback choices | 5 |
| command occurrences reaching preconditions | 0 |

### After — two independent runs on the rebased, post-review code

```
bun run --cwd apps/e2e bench:ai-baseline -- --label 415-postreview   --reps 10 --sweep-samples 0 --no-contention
bun run --cwd apps/e2e bench:ai-baseline -- --label 415-postreview-b --reps 10 --sweep-samples 0 --no-contention
```

Raw evidence (gitignored): `.evidence/382-baseline/{382-before-reasoning,415-postreview,415-postreview-b}`.

### Envelope extraction — the layers kept separate

| stage | metric | value |
|---|---|---|
| transport | attempts | **20** |
| transport | HTTP 200 returned | **19** |
| transport | aborted at the unchanged 6 000 ms budget | **1** |
| transport | latency of the completed calls, min/med/max | **2 374 / 4 550 / 5 814 ms** |
| transport | every completed call inside 6 000 ms | **yes** |
| tokens | completion, min/med/max | **109 / 214 / 281** |
| tokens | prompt, min/med/max | 2 393 / 2 409 / 2 477 |
| gameplay | extraction accepted | **16/20** |
| gameplay | malformed result → degraded | **3** |
| gameplay | timeout → degraded | **1** |
| gameplay | deterministic fallback choices | **4/20** |
| gameplay | AI-authored choices | **16/20** |
| gameplay | command occurrences denied by preconditions | **6** |
| gameplay | top-level commands accepted | **3** |
| turn | all turns schema-valid, non-empty narrative, `source: 'ai'` | **20/20** |

The split between *transport* and *gameplay* is the point. **19/20 completed is
not 19/20 successful AI choices.** Three completed calls returned metadata the
schema rejects — observed in the probe as `{"kind":"offerQuest"}` with the
required `questId` omitted — and one hit the deadline. All four degraded to the
streamed narrative with derived choices, which is the correct outcome, and
before this change that path was unreachable in production because nothing ever
arrived in time to be rejected.

The timeout/malformed split is derived from the wire record, not inferred: an
aborted extraction necessarily produced a degraded turn, so
`timeouts = byCall.extraction.aborted` and `malformed = degraded − timeouts`.
An earlier attempt inferred it from `turn wall − ttft` and produced a
contradiction (a "timeout" in a run with zero aborted calls) — that tail
includes post-extraction work, so the inference was unsound and was discarded.

The per-call latency and token figures are read from the wire log, restricted
to the last `reps` structured calls, and **cross-checked against the harness's
own `byCall` totals** (19/9 and 10/10, matching in both runs) rather than
trusted from one source.

### Turn latency and TTFT

| | before (n=5) | after (run A, n=10) | after (run B, n=10) |
|---|---|---|---|
| turn wall clock (median) | 10 063 ms | 9 610 ms | **9 026 ms** |
| turn TTFT (median) | 4 062 ms | 4 642 ms | 4 212 ms |

TTFT is unchanged in kind and should be: the narrative is a different task on a
different code path. The wall-clock saving is the ~6 000 ms of discarded
extraction replaced by a ~4 500 ms extraction that is mostly used.

## Regression checks

Pooled over both post-review runs (20 turns).

| property | result |
|---|---|
| call-1 narrative authoritative | unchanged; extraction cannot replace it (no `narrative` field exists in the schema) |
| valid model-authored choices survive filtering | 16/20 turns carried 3–4 distinct, player-meaningful ids |
| invalid choices do not | preserved and unchanged (`_filterChoices`) |
| commands reach precondition evaluation | **6 command occurrences denied, 3 top-level accepted — the first time this path has run in production** |
| denied commands remain denied | every denial kept the narrative rendering and the turn schema-valid |
| malformed extraction degrades safely | 3 turns → narrative-only + derived choices; never a partial or invalid turn |
| extraction timeout degrades safely | 1 turn; path unchanged and unit-covered by #414's tests |
| empty narrative | still a provider failure before call 2 (#414) |
| cancellation | unchanged; no cancellation code touched |
| `#410` absolute deadline | `budgetMs: 6_000` untouched; no layer restarts it |
| `#411` in-flight coalescing | untouched; S4 still collapses 6 identical concurrent calls to 1 provider request |
| routing / explicit model / provider selection | untouched; same seeded vault, same resolution path, verified on all four routing branches by test |
| privacy / offline-only scope | untouched; no new network destination, no new provider |
| `budgetMs` raised? | **No.** 6 000 before, 6 000 after. |
| stored config format | untouched — no new persisted key, no migration |
| cross-request / cross-campaign state | none introduced; the preference is per-request, derived from the task preset |

### Sibling scenarios — unchanged, as they must be

| scenario | before | after (n=5, pre-review) | after (run A) | after (run B) |
|---|---|---|---|---|
| S1 cold start | 8 113 ms | 5 669 ms | 5 797 ms | 5 851 ms |
| S2 warm sequential (median) | 1 345 ms | 2 030 ms | 2 221 ms | 1 688 ms |
| S4 identical-concurrent | 6 req → 1 | 6 req → 1 | 6 req → 1 | 6 req → 1 |
| S5 distinct-concurrent (median / p95) | 4 983 / 11 061 ms | 5 048 / 11 538 ms | 6 717 / 12 870 ms | 6 148 / 13 245 ms |

S1/S2/S5 use other tasks, which keep the provider default, so the differences
are machine noise on a shared, GPU-less CPU. S4 still collapses to a single
provider request, which is #411's coalescing still intact. S5 is visibly
noisier than the earlier runs — the same machine, busier at the time — which is
why the envelope numbers above are pooled across two runs rather than taken
from the best one.

---

## Provider support — measured, not assumed

On the installed Ollama 0.34.3. **A `200` response is not a honoured field:**
Ollama accepts every one of these without error and honours exactly two of
them, and the two it honours are not the two a reader would guess.

| control | surface | honoured? |
|---|---|---|
| `think: false` | native `/api/chat` | **yes** — 0 reasoning chars, 8/8 in budget, 8/8 valid |
| `think: false` | `/v1/chat/completions` | no — accepted, ignored |
| `reasoning_effort: "none"` | `/v1/chat/completions` | **yes** — 0 reasoning chars, 8/8 in budget |
| `reasoning_effort: "none"` | native `/api/chat` | no — accepted, ignored |
| `reasoning_effort: "minimal"` | `/v1/chat/completions` | no — not a "lower it" dial; reasoning stays fully on |
| `chat_template_kwargs.enable_thinking: false` | `/v1/chat/completions` | no — not forwarded, though the model's own template branches on it |

Only two are **declared** in `ProviderDescriptor.reasoningControl`, and only one
is declared by a provider:

- `ollama-native-think` — declared by `ollama`. This is what production uses.
- `openai-compat-reasoning-effort` — wired and unit-tested, declared by **no**
  provider, because no cloud provider has been measured against it here. An
  unmeasured capability is not a capability, so it ships dormant rather than
  speculative.

### The capability is surface-qualified, and the adapter enforces that

`think: false` is not "something Ollama supports". It is something Ollama
supports **on `/api/chat`**, where `reasoning_effort` is accepted and ignored.
Had the value been provider-only, a future change that routed `ollama` through
`/v1` — for instance to gain `response_format` — would have kept sending a
field the provider returns `200` for and does nothing, silently restoring the
6 000 ms failure while every test stayed green.

So `reasoningControl` names a **(provider, surface)** pair, and
`buildReasoningParams` emits the field only when the surface it is about to use
matches:

- `resolveChatSurface` is the single source of truth for the transport;
- `resolveChatUrl` branches on it, so URL and spelling cannot disagree;
- a declared control on the wrong surface is **dropped**, giving the old
  byte-identical body rather than a silent no-op.

Three tests pin this: the native control is dropped for a compat-surface
provider, the compat control is dropped for a native-surface provider, and the
correct pairing still emits the right field.

---

## Tests

| suite | what it pins |
|---|---|
| `frontend-ai-gateway/tests/text_adapters.test.ts` (+9) | the exact wire field per (control, surface); **dropped on a surface mismatch, both directions**; absent when undeclared; absent when not asked for; `reasoning: 'default'` sends nothing; **a `reasoning` key smuggled through connection `params` does not reach the wire**; generation params intact when the control is dropped |
| `client/.../ai_gateway_reasoning_resolution.test.ts` (new, 8) | the task preference reaches `AiModeResolution.reasoning` on **all four routing branches**; no player-facing task resolves to a preference on any of them; a task-less call has none; **it never lands on the connection params** |
| `client/.../text_task_params.test.ts` (+4) | merging never introduces a `reasoning` key; the task presets still declare the preference; the four player-facing tasks do not |
| `constants/text_task.test.ts` (+2) | **exactly one** task opts out — the exact set, so a future refactor cannot silently spread it; no preset invents a value outside the union |
| `constants/providers.test.ts` (+3) | only the measured provider declares a control; unmeasured and unknown ids declare nothing rather than throwing |

The resolution test was **proved to fail** when it should: dropping `task` from
a single one of the four `_toTextResolution` call sites turns exactly one test
red and leaves the other seven green. A green run of a test that cannot fail is
not evidence, so this was checked rather than assumed.

---

---

## Verification (each command confirmed to execute)

| command | result |
|---|---|
| `bun moon run schemas:typecheck --force` | clean |
| `bun moon run types:typecheck --force` | clean |
| `bun moon run constants:typecheck --force` | clean |
| `bun moon run constants:test --force` | 238 pass, 0 fail |
| `bun moon run frontend-ai-gateway:typecheck --force` | clean |
| `bun moon run frontend-ai-gateway:test --force` | 107 pass, 0 fail |
| `bun moon run client:typecheck --force` | 0 errors, 0 warnings |
| `bun moon run client:test --force` | 4 351 pass, 0 fail, 4 354 tests across 330 files |
| `bun moon run e2e:typecheck --force` | clean |
| `bun run scripts/src/lib/ops/run_guards.ts` | 10/10 guards pass |
| `bun run lint` | clean |

`--force` throughout, because Moon has been observed reporting a cached no-op
typecheck as a pass. No guard baseline was raised and no waiver was added.

---

## What is still open on #382

Issue #382 stays **open**. The envelope bottleneck is resolved; the
`MAP_LOADED` background-summarization contention result is **not** addressed
here and is now measurable cleanly, because the interactive path no longer
carries a 6 000 ms dead call per turn. The next step is the contention A/B at
burst widths 1 / 2 / 4 NPCs, counting actual `summarization` provider calls
rather than candidates handed to `prefetchForNpcs`, and choosing between a
bound and interactive priority on the evidence rather than assuming the answer
is "limit 2".

Also still outstanding and untouched: prewarming, context compression, provider
caching, and the P1/P2 task-budget sweep beyond the envelope.
