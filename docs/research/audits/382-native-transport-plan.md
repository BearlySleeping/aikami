# Lane plan — native transport, deadlines and attempt accounting

**Lane:** `perf/382-native-transport-deadlines-accounting`
**Refs:** #382 (and #381, whose boundary this lane must not cross)
**Base SHA:** `6325e9bc5bd959dceef180de2a73827707c25054` (== `origin/main` at
checkout time, 2026-10-01, with #417 merged — the reviewed snapshot is current
`main`, so nothing here is a re-litigation of a newer commit)

This document is the lane's own audit record. It exists before the code so the
scope, the interfaces and the deferrals can be checked against what was
actually delivered.

---

## 1. What the wire actually says (pre-change evidence)

Captured with
`.evidence/382-native-transport/probe_capabilities.mjs` against the pinned
runtime — **Ollama 0.34.3**, `ornith-1.5:9b` (Qwen3.5 family, Q4_K_M, 6.6 GB,
declared 262144 ctx, capabilities `tools, thinking, completion, vision`) on an
RTX 4090 Laptop (16 376 MiB) / i9-14900HX / 32 threads. Raw output:
`.evidence/382-native-transport/probe-raw.jsonl`.

| Finding | Wire evidence | Verdict |
|---|---|---|
| Native `generatePlain` is buffered | `stream:false` → `headersMs 9607`, `totalMs 9608` | **Confirmed.** No first-content time exists on this route. |
| The old route has no first-token measurement | headers and total differ by 1 ms | **Confirmed.** Buffered completion is not TTFT and must never be relabelled as such. |
| `stream:true` is real NDJSON | 312 newline-delimited frames, `content` deltas, final `done:true` frame | **Confirmed.** A line reader is required, not an SSE parser. |
| Thinking is a separate channel on the SAME surface | first frames are `{"message":{"role":"assistant","content":"","thinking":"The"}}`; first *content* 5616 ms vs first *frame* 94 ms | **Confirmed, and material.** 94 ms is NOT visible TTFT. |
| `message.content` is the narrative channel | probe 1: 281 content chars against `eval_count 334` — the balance went to `message.thinking` | **Confirmed.** Only `message.content` may be delivered or counted. |
| `done_reason` is present | `"stop"` and `"length"` observed | **Confirmed.** Truncation is detectable, so a token cap is not silent. |
| `prompt_eval_cached_count` exists on 0.34.3 | `0` on a cold-shaped call, `18` on the warm streamed call | **Confirmed.** Cached-token provenance is obtainable on this runtime. |
| Native `format: <JSON Schema>` works | 200, whole body parses, schema-conformant output, `done_reason: stop` | **Confirmed.** Structured extraction can be schema-constrained natively. |
| `options` are honoured | `num_predict 12` → `eval_count 6`, `done_reason: stop`; `top_k`/`repeat_penalty`/`num_ctx` all 200 | **Confirmed.** |
| **Unsupported option keys are silently ignored** | `num_gpu`, `totally_made_up_option` → **200**, no diagnostic | **Confirmed — and the reason the mapping must be allow-listed.** |

The last row is the load-bearing one. Because Ollama 0.34.3 answers `200` to an
option it does not understand, a request cannot be used to discover support. The
only honest mechanism is an **allow-list built from measured fields**: a
`TextParams` field with no measured native spelling must be **omitted from the
body and reported as unmapped**, never sent and silently assumed honoured.

### Superseded / not-carried findings

| Source finding | Disposition |
|---|---|
| "Native structured requests do not select Ollama's format schema" | **Carried.** Fixed in `native_format.ts`. |
| "buildGenerationParams skips Ollama, buildBody supplies no native options" | **Carried.** Fixed in `native_options.ts`. |
| "withRequestScope creates a 90s timer per scope; higher logical dialogue budget is 120s" | **Carried, and now precisely characterised** — see §2. |
| "combat-intent soft race returns without abort, then clears the service hard timer" | **Carried.** |
| "readChatSseStream leaves losing timers alive; usage/empty retry paths can lose attempted usage" | **Carried.** |
| #416 / #417 historic reports | **Left immutable.** No number from them is restated as a streaming measurement. |

---

## 2. The deadline policy decision (not "raise every timeout")

The mismatch is not "90 is too small". It is that **two layers each own a
budget and neither knows about the other**:

- `npc_dialogue_service.svelte.ts:471` — `DEFAULT_DIALOGUE_TIMEOUT_MS = 120_000`
  is the *logical* budget for one dialogue turn;
- `ai-gateway/src/lib/sse.ts:12` — `GATEWAY_FETCH_TIMEOUT_MS = 90_000` is minted
  **per request scope**, inside `withRequestScope`, and is invisible to any
  caller;
- `AiTextGenerationOptions` has **no `deadlineAt` field at all**, so the client's
  already-correct `createRequestDeadline` (in `ai_request_deadline.ts`, lane A's
  territory) can never reach the transport.

Consequences, both real: a 120 s dialogue turn is silently truncated at 90 s, and
a 4 s combat turn is *over*-served at 90 s because the transport ignores the
budget entirely.

**Policy chosen — the caller's absolute instant is the only logical budget.**

1. The gateway gains an **additive** `deadlineAt?: number` on the call surface
   and the adapter context. It is optional, so no existing consumer changes.
2. When present it is adopted **verbatim** and is the authority for dispatch,
   headers, first visible content, idle watchdog, body read, parse/validation,
   empty-body backoff and retry. Every one of those draws it down.
3. When absent, the adapter keeps a **finite safety limit** for direct callers,
   and that limit is a *watchdog*, not a logical budget. It is documented as
   such and named distinctly in errors.
4. The first-visible-content and idle watchdogs stay intentionally shorter than
   the total. This is a deliberate liveness guard, documented, and it is NOT the
   answer to a slow generation.

Failure kinds are **named separately** so "the total budget ran out", "no
visible content arrived" and "the stream stalled mid-content" are three
different facts: `timeout` / `first_content_timeout` / `idle_timeout`.

## 3. Interfaces (all additive)

| Interface | File | Consumers |
|---|---|---|
| `AiTextGenerationOptions.deadlineAt?` | `gateway_types.ts` | callers that already own a budget |
| `AiAdapterContext.deadlineAt?` | `gateway_types.ts` | adapters |
| `AiTransportAttemptEvent` + `onAttempt?` | `gateway_types.ts` | lane A's coalescer (no edit required) |
| `createGatewayDeadline`, `GatewayDeadline` | `deadline.ts` (new) | adapter internals |
| `readNativeNdjsonStream` | `ndjson.ts` (new) | native narrative path |
| `buildNativeOptions` / `NativeOptionsReport` | `native_options.ts` (new) | native body build |
| `readNativeUsage` | `native_usage.ts` (new) | native accounting |
| `buildNativeFormat` | `native_format.ts` (new) | native structured path |
| `AiTextUsage.totalComplete?`, `cachedSource?` | `gateway_types.ts` | telemetry |
| `TextTelemetrySpan` attempt fields | `@aikami/types` | recorder + report |

`structured.ts` (lane A) is **not** touched. The compiler API is reused
unchanged; native `format` is built by calling `compiler.compile(...)` and
handing the result to `buildNativeFormat`.

## 4. Ownership boundary

**Owned here:** `packages/frontend/ai-gateway/src/lib/{text_adapter_openai_compatible,sse,gateway_types,gateway,errors}.ts`, new
native/deadline/usage helpers and their tests, `combat_intent_service` + tests,
the dialogue timeout owner, `@aikami/types` text-telemetry, the client's
`telemetry_{service,pricing}`, `apps/e2e/scripts/ai_baseline_*`, this document
and `382-native-transport-report.md`.

**Not touched:** `text_generation_service.svelte.ts`, the coalescer, admission,
NPC lifecycle, `structured.ts`, any new decision-only module, the installed
runtime, model selection/residency policy, root manifests, lockfiles,
`.context/llms.txt`.

**Integration hotspot, edited once, additively:** `packages/frontend/ai-gateway/src/index.ts`
— six new exports and no signature change. Flagged for the reviewer because lane
A will also want to import from this barrel.

## 5. Test plan

Every correctness fix gets a regression that fails on the pre-change behaviour.

| Area | Case |
|---|---|
| NDJSON | chunk split inside UTF-8; split inside JSON; many lines per chunk; final line without newline; empty `content`; `thinking`-only frames; malformed record; `done`/`error` frame; EOF before `done`; abort mid-read; bounded buffer |
| NDJSON | thinking is never delivered and never advances visible-content timing; accumulated final text == concatenation of delivered fragments |
| Options | `maxTokens→num_predict`; temperature/top_p/top_k/repeat_penalty; context policy; unmapped fields **omitted and reported**; `min(connectionCap, taskCap)` |
| Usage | native counters; `prompt_eval_cached_count` present/absent; partial block → unknown; non-integer/negative rejected; units validated; no inference from latency |
| Format | schema sent natively; capability fallback without retry storm; TypeBox validation still authoritative |
| Deadline | expiry before dispatch, during headers, during streaming, during backoff, during retry; >90 s exercised on a **fake clock**, no wall-clock sleeps; three failure kinds distinguished; direct caller still gets a finite limit |
| SSE | timers cleared; reader cancelled; timeout/abort cannot become success; trailing usage preserved; protocol completion vs closed socket; callback throw is not reported as a parse error |
| Accounting | every dispatched attempt has identity + outcome; empty retry and invalid response retain attempted usage; partial totals stay partial; coalesced subscribers do not multiply spend |
| Combat intent | one soft budget across attempts; provider ignoring abort; slow-then-invalid and slow-then-valid; duplicate requestId deterministic; `cancel`/`cancelAll` own every live operation |

## 6. File budget

Planned ~33 changed files against a hard cap of 100 and a 60–85 target band. The
band is deliberately not padded: every item above is a distinct correctness
surface with its own regression, and the instruction is explicit that a correct
smaller PR beats artificial churn. If the delivered count lands below 60, that
is the honest number, not a shortfall to be filled.

## 7. What this lane deliberately does not claim

- No claim of higher generation throughput. TTFT and throughput are different
  quantities and only the first is measured here.
- No p99 from a small sample. The harness's own minimum-sample rule is kept.
- No dollar saving for local inference. Ollama bills nothing; that makes the
  *invoice* zero, and says nothing about electricity or hardware.
- No improvement inferred from shorter output. If a newly honoured `num_predict`
  truncates a reasoning model, that is recorded as a regression, not a win.
- No claim about a provider surface not measured on 0.34.3.
