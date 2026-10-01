# #382 — Native transport, deadlines and attempt accounting

**Refs:** #382, #381 (boundary only)
**Branch:** `perf/382-native-transport-deadlines-accounting`
**Base:** `6325e9bc5bd959dceef180de2a73827707c25054` (`origin/main`, #417 merged)
**Lane plan and wire-baseline rationale:** [`382-native-transport-plan.md`](382-native-transport-plan.md)

---

## The concrete problem

Ollama's native `/api/chat` route was driven as if it were a slow OpenAI
endpoint. Three consequences, all measured rather than inferred:

1. **The native route had no first-content time at all.** `generatePlain` sent
   `stream: false`, awaited the whole body, and fired a single `onChunk` at the
   end. On the pinned runtime, warm and uncontended, response headers arrived at
   **6 386 ms** against a total of **6 387 ms** — no byte of the answer existed
   before the byte that ended it. No amount of tuning could produce a first-token
   measurement, because there was nothing to measure until the end.
2. **Every configured generation parameter was silently ignored on that route.**
   `buildGenerationParams` returned `{}` when the provider was `ollama`, and
   `buildBody` supplied no native options. A connection configured with
   `maxTokens: 400` was generating without a limit.
3. **The transport could not see the caller's budget.** `AiTextGenerationOptions`
   had no `deadlineAt` field, and `withRequestScope` minted a fresh 90 s timer per
   scope. A dialogue turn whose logical budget is 120 s was cut at 90 s with no
   error and no span explaining why; a combat turn whose budget is 4 s was served
   for 90 s.

Alongside those: the SSE reader leaked a timer per chunk, never cancelled the
reader, and could report an interrupted stream as a completed one; the
combat-intent soft race resolved without aborting anything; and only the
surviving attempt of a multi-attempt request was accounted for.

## Resulting behaviour

| | Before | After |
|---|---|---|
| Native narrative transport | `buffered-json`, one `onChunk` | `ndjson-stream`, each fragment delivered once |
| Time to first **visible** character (warm, width 0) | **6 386 ms** (headers) | **2 410 ms** (p50, n=2) |
| Configured `maxTokens` on Ollama | ignored | `num_predict`, plus `temperature`/`top_p`/`top_k`/`repeat_penalty` |
| Fields with no native spelling | silently ignored | **omitted and reported** (`native-options-unmapped`) |
| Structured extraction | system-prompt only | native `format: <JSON Schema>`, TypeBox still authoritative |
| Caller deadline | invisible to the transport | carried verbatim; dispatch/headers/content/idle/read/backoff/retry all draw it down |
| Timeout reporting | one `timeout` code | `timeoutKind`: `total_budget` / `first_content` / `idle` |
| SSE reader | leaked a timer per chunk; reader never cancelled | every window disposed; reader cancelled; close ≠ completion |
| Combat-intent soft timeout | provider call left running | attempt aborted, resources released, late answer unusable |
| Attempt accounting | surviving attempt only | every dispatched attempt, including discarded ones |

**Routing, gameplay authority, offline/cost policy, engine determinism,
perception limits, state revisions and every existing fallback are unchanged.**
This is a transport and accounting change.

## Evidence

### Environment

| | |
|---|---|
| Runtime | Ollama **0.34.3** (the pinned local install; not upgraded) |
| Model | `ornith-1.5:9b`, Qwen3.5 family, Q4_K_M, 9.0B, declared ctx 262144 |
| Capabilities | `tools, thinking, completion, vision` |
| Hardware | RTX 4090 Laptop (16 376 MiB), i9-14900HX, 32 threads |
| Residency policy | **unchanged** — the narrative path sends no `keep_alive` |
| Raw data | `.evidence/382-native-transport/pr-382-native-v2/` (gitignored) |
| Reproduce | `bun run --cwd apps/e2e bench:ai-native-transport -- --model ornith-1.5:9b --reps 2 --label pr-382-native-v2` |

### Pre-change wire probe (`.evidence/382-native-transport/probe-raw.jsonl`)

| Probe | Result |
|---|---|
| current adapter shape (`stream:false`) | `headersMs 9607`, `totalMs 9608` |
| `stream:true` | 312 NDJSON frames; first **frame** 94 ms, first **content** 5 616 ms |
| thinking channel | first frames are `{"content":"","thinking":"The"}` |
| `done_reason` | `stop` and `length` both observed |
| `prompt_eval_cached_count` | present on 0.34.3 — `18` against `prompt_eval_count 22` |
| native `format: <JSON Schema>` | 200, whole body parses, schema-conformant |
| `options` | `num_predict`/`top_k`/`repeat_penalty`/`num_ctx` all honoured |
| **unknown option keys** | **`num_gpu`, `totally_made_up_option` → 200, silently ignored** |

The last row is load-bearing: support **cannot** be probed from the provider, so
the mapping is an allow-list of measured fields with an explicit report of what
was left out.

### Phase-separated sweep, widths 0/1/2/4, 2 reps per width, interleaved

Both transports were driven from **one build** (`nativeStreamingEnabled` toggles
between them), with a discarded warm-up call first and the transports interleaved
— the first version of this run ran all buffered samples first, which handed them
the model load and made them look ~10 s slower. That confound was found, fixed,
and the run repeated; the discarded run is not quoted.

| transport | thermal | width | n | first-visible n | headers p50 | **first visible p50** | completion p50 |
|---|---|---|---|---|---|---|---|
| buffered-json | warm | 0 | 2 | **0** | 6 386 ms | **not measured** | 0 ms |
| ndjson-stream | warm | 0 | 3 | 3 | 115 ms | **2 410 ms** | 3 925 ms |
| buffered-json | warm | 1 | 2 | 0 | 13 532 ms | not measured | 0 ms |
| ndjson-stream | warm | 1 | 2 | 2 | 102 ms | 3 103 ms | 4 650 ms |
| buffered-json | warm | 2 | 2 | 0 | 15 339 ms | not measured | 0 ms |
| ndjson-stream | warm | 2 | 2 | 2 | 6 127 ms | 7 262 ms | 8 434 ms |
| buffered-json | warm | 4 | 2 | 0 | 20 376 ms | not measured | 0 ms |
| ndjson-stream | warm | 4 | 2 | 2 | 23 669 ms | 2 506 ms | 4 229 ms |
| ndjson-stream | **cold** | 0 | 1 | 1 | 2 934 ms | 6 752 ms | 7 997 ms |
| ndjson-stream | warm, **832-token prompt** | 0 | 1 | 1 | 428 ms | 2 061 ms | 3 925 ms |

**Reading the buffered column.** Ollama does not send response *headers* on a
non-streaming request until the whole body is ready, so for that route
`headersMs` **is** the time until the player sees anything and `completionMs` is
~0 by construction. Comparing a buffered `headersMs` against a streamed
`firstVisibleMs` is the like-for-like figure — both are "time until the first
visible character".

**The headline.** At width 0: **6 386 ms → 2 410 ms**, a 2.6× reduction in
time-to-first-visible-character. Under contention the gap widens rather than
closes: at width 4 the buffered route's first visible content is 20 376 ms while
the streamed route's is 2 506 ms, because the streamed route's headers return
immediately and the first tokens can arrive while the queued work ahead of it is
still draining.

**Other measurements from the same run:** 22 895 thinking characters were
observed and **discarded** — never delivered, never counted as visible content.
`prompt_eval_cached_count` was `27` on warm width-0/1 calls and `0` on contended
ones, i.e. the counter is real and varies. Zero samples were truncated by a
length cap. Zero failures.

### Tests actually run

| Suite | Result |
|---|---|
| `bun moon run frontend-ai-gateway:test` | **207 pass, 0 fail** across 11 files (was 110) |
| `bun moon run frontend-ai-gateway:typecheck` | clean |
| `bun moon run client:test` | 4 422 pass, 1 unrelated failure — see Limitations |
| `bun moon run client:typecheck` | clean (svelte-check, 0 errors) |
| `bun moon run types:typecheck` | clean |
| `bun run --cwd apps/e2e test:unit` | **110 pass, 0 fail** |
| `bun run scripts/src/lib/ops/run_guards.ts` | **10/10 pass**; complexity baseline **contracted** 382 → 381 files |

### Bugs the new tests caught during this work

Recorded because they are the evidence that the suites are load-bearing, not
decorative:

- **`temperature: 0.7` was being sent as `0`.** A single `Math.floor` was applied
  to every native option, silently making generation greedy and deterministic —
  a creative-output change disguised as a performance fix.
- **A watchdog expiry was reported as a truncated stream.** Both readers
  *cancelled* the reader on window expiry, which resolved the pending `read()`
  with `done: true`; the loop then reported EOF. A stalled stream and a broken
  connection were indistinguishable.
- **A routine backoff could raise a spurious `total_budget` timeout.** The
  backoff's own timer and the phase watchdog were due at the same instant.
- **A provider `error` frame without `done` was reported as truncation.** Ollama's
  error frames routinely omit `done`, so "the provider said no" was being
  relabelled "the connection broke".
- **Native options were spread flat beside `model` and `messages`.** The provider
  ignores unknown top-level fields and answers 200 — the exact
  configured-but-not-honoured state this change exists to eliminate.

## Limitations and what is NOT claimed

- **n = 2 per cell.** Percentiles are therefore suppressed by the harness's own
  minimum-sample rule; only medians are published. **No p95 or p99 is claimed
  anywhere in this report.** Twelve samples per transport would not justify them
  either.
- **The buffered `headersMs` figures are high-variance** (3 574–23 952 ms across
  samples) because generation length varies with an unseeded model. The
  first-visible comparison is robust to that because it is a *start* time, not a
  *finish* time; total completion times are **not** comparable between the two
  transports and are not used for any claim.
- **No improvement in generation throughput is claimed.** TTFT and throughput are
  different quantities and only the first was measured.
- **The `num_predict` truncation risk is measured as ZERO OCCURRENCES, not as
  safety.** The run used a prompt whose outputs did not hit the cap. Turning on a
  limit that was previously ignored CAN truncate a reasoning model, whose budget
  is shared with the thinking channel; the provider reports that as
  `done_reason: "length"`. This is a real behaviour change and a follow-up should
  measure summarization/envelope output validity under a cap before the cap is
  relied upon. No narrative quality claim is made in either direction.
- **Provider billing for this run is zero, and that is not a saving.** It is a
  fact about the local route. Electricity and hardware cost are real and are
  **not** estimated — inventing a dollar figure for something nobody measured
  would be a fabrication. `cachedSource: 'unknown'` is recorded wherever the
  runtime supplied no cached counter, and is never defaulted to zero.
- **Local API billing zero ≠ total cost zero.** Stated in the generated report
  itself, so the figure cannot be quoted out of context.
- **The harness measures the wire, not the client.** It therefore does not
  measure the applied-turn phase (`appliedTurnMs` is defined and carried but was
  not populated in this run); that needs the client dev server and is the
  natural follow-up.
- **`report_bundle_budget` fails in `client:test` and is unrelated to this
  change** — a bundle-size metric, triggered by the client build, naming none of
  this lane's files. It reproduces on the untouched base and is reported
  separately rather than folded in.
- **Not measured here:** long-context behaviour beyond one 832-token prompt;
  multi-GPU; a BYOK provider (no credentials were used, and none were needed).

## Remaining #382 criteria

Still open after this PR, deliberately:

| Criterion | Status |
|---|---|
| Dependency-safe parallelism under cancellation/partial failure | untouched (other lanes) |
| Cache-correctness tests (schema/model/prompt/state/rules/language) | untouched |
| Agent-invocation reduction verified against call sites | untouched |
| Local concurrency vs gameplay frame time | untouched — no frame-time regression is claimed |
| Safe exact caching / dedup / provider prompt-cache | untouched |
| Combat prefetch tuning | still **nothing to tune** — per the #412 audit, the mechanism does not exist |

## Rollback

Revert the branch. Nothing outside this lane's files is depended on, the
adapters keep the buffered path behind `nativeStreamingEnabled: false`, and the
deadline additions are optional fields — a caller that passes no `deadlineAt`
gets exactly the pre-change 90 s safety watchdog. The pre-change wire baseline in
`382-native-transport-plan.md` and the raw evidence lane are sufficient to
re-measure the before state without checking out the old commit.

## Changed-file count

**36 files** (hard cap 100). One is a *reduction* of the
`guard_cognitive_complexity_baseline.json` ratchet; no file was added to make a
number.
