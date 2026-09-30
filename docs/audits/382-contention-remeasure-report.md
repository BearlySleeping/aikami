# Issue #382 — `MAP_LOADED` contention, re-measured after the envelope fix

**Status:** measurement. No scheduling, routing, timeout, model or configuration
change. Client code at `main` is untouched; only the measurement harness changed.
**Commit:** `7c0d17c528a553a8da6a58708bd2bc5cb4b0edd4` (`v0.0.107-1466-g7c0d17c52`) — the
merge of #415, which is the current `main`.
**Measured:** 2026-09-30, 48 real dialogue turns on one local machine.
**Harness:** `bun run --cwd apps/e2e bench:ai-baseline`
**Raw runs (gitignored):** `.evidence/382-baseline/382-contention-remeasure/`
(the width sweep, checkpointed) and `.evidence/382-baseline/382-contention-context/`
(S1–S5 and the uncontended P1 dialogue turns, same commit, same session).

---

## Headline

**Classification: B — even a single background summarization is harmful.**

One overlapping `MAP_LOADED` opener refresh raises median dialogue TTFT from
**4 796 ms to 21 449 ms (+347 %)** on this configuration. Four raise it to
**62 811 ms (+1 210 %)**, and at that width **4 of 12 dialogue turns failed
outright** — the narrative call was killed by the gateway's 90 s fetch timeout
and `generateTurn` rethrew, which the client deliberately surfaces to the player
rather than faking.

`max concurrency = 2` would not have prevented any of this. A bounded-concurrency
semaphore is the wrong shape for a problem that is already present at width 1.

**And the earlier "it was the broken envelope" hypothesis is wrong.** The #415
envelope fix is active and verified on the wire in this run (`think: false` on
every measured extraction). The contention is now almost entirely in the
**narrative** call: at every width the call-1 duration and the turn's TTFT are
the same number, and call 1 is what inflates. The extraction's own latency does
not degrade with burst width (median 2 881 / 2 746 / 2 981 / 2 622 ms across
widths 0/1/2/4). #413's headline penalty was not an artefact of the dead
envelope path — it was real, and after the fix it is still real, with a
different and better-localised cause.

---

## The headline table

| width | valid samples | actual bg calls (wire) | actual bg spans (client) | in-flight at dialogue start | TTFT median (min–max) | wall median (min–max) | bg median (min–max) | failures |
|---|---|---|---|---|---|---|---|---|
| 0 | 12 / 12 | 0 | 0 | 0 | **4 796** (3 119–7 000) | 8 365 (5 747–11 483) | n/a — no burst | 0 |
| 1 | 12 / 12 | 12 | 12 | 12 | **21 449** (5 014–26 810) | 22 143 (11 017–29 563) | 13 993 (8 125–21 253) | 0 |
| 2 | 12 / 12 | 24 | 24 | 24 | **37 094** (20 855–58 916) | 40 080 (25 411–63 089) | 23 822 (7 837–54 027) | 0 |
| 4 | 12 / 12 | 48 | 48 | 48 | **62 811** (5 209–85 124) | 65 146 (11 211–86 246) | 45 550 (8 035–90 003) | **4 turns failed outright** |

All times in milliseconds. `bg median` is the median duration of an individual
background `summarization` request on the wire.

| width | TTFT vs control | wall vs control | samples slower than the slowest control sample |
|---|---|---|---|
| 0 | 1.00× | 1.00× | — |
| 1 | **4.47× (+347 %)** | 2.65× (+165 %) | **11 / 12** |
| 2 | **7.73× (+673 %)** | 4.79× (+379 %) | **12 / 12** |
| 4 | **13.10× (+1 210 %)** | 7.79× (+679 %) | 7 / 8 completed (4 failed) |

The last column is the one that matters for "is this noise": the slowest control
turn is 7 000 ms. At width 2 every single sample beats it. At width 1, 11 of 12
do. The distributions do not overlap at the top.

**Two overlapped samples escaped the penalty entirely** — sample 21 (width 1,
TTFT 5 014 ms) and sample 13 (width 4, TTFT 5 209 ms) — both of which still had
their full background burst genuinely in flight. So the mechanism is not
deterministic: roughly 1 in 16 overlapping samples finds a gap in which the
interactive call is served at control speed. That is stated rather than hidden,
and it does not change the direction of the effect.

---

## Machine, runtime and route

| | |
|---|---|
| CPU | Intel Core i9-14900HX, 32 logical cores |
| RAM | 31.1 GB |
| GPU | **NVIDIA GeForce RTX 4090 Laptop GPU, 16 376 MiB** — Ollama's `llama-server` holds 6 444 MiB of it |
| OS | Linux 7.2.8 x86_64 |
| Ollama | 0.34.3 (`/api/version`) |
| Model | `ornith-1.5:9b` — 9.0B, Q4_K_M, 6.55 GB on disk, declared context 262 144 |
| Runtime context | **4 096** (`/api/ps`, the value the provider actually runs) |
| Residency | `size_vram` 5 526 918 266 == model size 5 526 918 266 → **fully resident in VRAM** |
| Provider route | Ollama **native `POST /api/chat`** — 100 % of captured requests, while the connection is configured as `http://localhost:11434/v1` |
| `OLLAMA_NUM_THREADS` | unset (server default) — not exposed by any Ollama endpoint |
| Warm state | resident for the whole sweep; the cold-start scenario was deliberately skipped (see *Ordering* below) |

> ### 🔴 Correction to the machine description used by #412 and #413
>
> Those reports describe this host as **CPU-only**. It is not. `lspci` on this
> machine reports **no display adapter at all** — that is where the claim came
> from — while `nvidia-smi` reports a fully loaded compute GPU and Ollama's own
> `/api/ps` reports the model as `size_vram == size`.
>
> This matters for reading this report against the previous ones: a contention
> figure from a GPU-backed runtime and one from a CPU-only host are different
> measurements. The harness now records GPU identity from `nvidia-smi`, the PCI
> view from `lspci`, the provider's own residency record, and the compute
> process list, precisely so a single silent source cannot describe the machine
> wrongly again.

---

## Method

### The production path, not a synthetic proxy

Both surfaces are the real ones, driven through the client's non-production test
seam:

- **Interactive:** `NpcDialogueService.generateTurn` — the C-401 two-call split
  (call 1 `dialogue` narrative, call 2 `envelope` metadata extraction) plus the
  turn's own validation, choice filtering and command-precondition whitelist.
- **Background:** `NpcMemoryService.prefetchForNpcs` — the exact method
  `bridge_listeners.ts:236` calls on `MAP_LOADED`, with the production
  arguments. It is fire-and-forget and returns `void`, so nothing about it is
  inferred from its return value.

`prefetchForNpcs` sorts the map's remembered NPCs by `lastTalkedAt` and slices to
`NPC_MEMORY_MAP_PREFETCH_LIMIT`, which is **4** at this commit
(`packages/shared/constants/src/lib/npc_memory.ts:37`). So width 4 is the
production maximum, read from source rather than assumed, and the sweep used it.

The burst NPC pool deliberately **excludes** the dialogue NPC. Production
includes the NPC a player is talking to; keeping it out means every provider
request in a measured window is unambiguously background or interactive,
decided by a measured time boundary rather than by asking which NPC a prompt
mentioned.

### Proving the burst actually fired

This is the failure the #413 report documents, and it is guarded three ways.

1. **Memory is prepared through the production `hydrate` path**, with a
   *missing* opener, before every sample, for the whole pool regardless of
   width. `recordConversation` is never used: its digest creates a fresh opener
   and `prefetchForNpcs` then skips the NPC. Hydrating only `width` NPCs would
   also have varied the dialogue turn's own context with the width.
2. **Fan-out is counted, never inferred.** Two independent sources must agree
   per sample: client telemetry spans with `task: 'summarization'`, and provider
   requests on the wire attributed by a measured time boundary. A width-N sample
   with fewer than N of either is recorded as **invalid** and excluded from the
   aggregates.
3. **Overlap is measured, not assumed.** For every sample, background requests
   still executing at the moment the provider started serving the player's first
   request. All 36 overlapped samples: 12/12, 12/12 and 12/12 overlapped.

> The count is taken from a **monotonic span id above a cursor**, not from a
> before/after difference of buffer totals. `textTelemetryService` is a
> **100-entry ring buffer**; past 100 calls in a run, a new span evicts an old
> one and the per-task total stops growing, so a total-based delta reads *zero*
> for a burst that demonstrably fired. An intermediate run of this sweep hit
> exactly that and correctly marked the affected sample `INVALID`; the guard
> worked, and the counting was changed rather than the sample being kept.

### Ordering

A repeated Latin-square rotation, so each width occupies each of the four
ordinal positions exactly three times. Deterministic, not random, and recorded:

```
0,1,2,4  1,2,4,0  2,4,0,1  4,0,1,2   (×3 blocks = 48 samples)
```

The previous design was a paired `quiet → overlapped` A/B repeated ten times,
which always ran the control first and so confounded the variable under test with
machine warm-up. It was replaced, not kept as an option.

Cold start was skipped on purpose: evicting the model makes the first control
sample pay a ~5 s load that no later sample pays, which is a warm-up artefact
rather than a contention measurement. Residency is recorded in the manifest
instead.

### A turn that fails is a result, not an error

`generateTurn` deliberately rethrows provider failures ("a broken provider must
be visible as an error rather than silently faked"). A rejected turn is therefore
recorded as a sample with a wall clock and no TTFT, and excluded from the
successful-turn medians rather than being allowed to flatter them. An earlier
version of this harness aborted the entire run on the first such rejection,
losing every later sample with it.

### Raw per-sample values

| # | w | bg reqs | bg spans | in-flight | turn | TTFT | wall | call 1 | call 2 | extraction | frame med | frame max | slow frames | longtasks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 0 | 0 | 0 | ok | 6852 | 9739 | 6850 | 2881 | degraded | 16.7 | 17.7 | 0 | 0 |
| 2 | 1 | 1 | 1 | 1 | ok | 12464 | 14975 | 12461 | 2506 | accepted | 16.7 | 20.2 | 0 | 0 |
| 3 | 2 | 2 | 2 | 2 | ok | 44753 | 47248 | 44751 | 2490 | accepted | 16.7 | 18.5 | 0 | 0 |
| 4 | 4 | 4 | 4 | 4 | **FAILED** | n/a | 90004 | 90001 | — | — | 16.7 | 26.9 | 0 | 0 |
| 5 | 1 | 1 | 1 | 1 | ok | 16993 | 22143 | 16986 | 5145 | accepted | 16.7 | 22.0 | 0 | 0 |
| 6 | 2 | 2 | 2 | 2 | ok | 32760 | 33353 | 32759 | 589 | accepted | 16.7 | 24.8 | 0 | 0 |
| 7 | 4 | 4 | 4 | 4 | ok | 43029 | 49031 | 43027 | 5999 | degraded | 16.7 | 24.5 | 0 | 0 |
| 8 | 0 | 0 | 0 | 0 | ok | 7000 | 11483 | 6997 | 4478 | accepted | 16.7 | 23.9 | 0 | 0 |
| 9 | 2 | 2 | 2 | 2 | ok | 27295 | 29741 | 27293 | 2441 | accepted | 16.7 | 24.6 | 0 | 0 |
| 10 | 4 | 4 | 4 | 4 | ok | 72883 | 74530 | 72881 | 1642 | accepted | 16.7 | 31.9 | 0 | 0 |
| 11 | 0 | 0 | 0 | 0 | ok | 4708 | 7376 | 4705 | 2663 | accepted | 16.7 | 24.3 | 0 | 0 |
| 12 | 1 | 1 | 1 | 1 | ok | 22030 | 28033 | 22029 | 6000 | degraded | 16.7 | 42.4 | 1 | 0 |
| 13 | 4 | 4 | 4 | 4 | ok | 5209 | 11211 | 5208 | 5999 | degraded | 16.7 | 24.6 | 0 | 0 |
| 14 | 0 | 0 | 0 | 0 | ok | 6517 | 8365 | 6515 | 1844 | degraded | 16.7 | 24.7 | 0 | 0 |
| 15 | 1 | 1 | 1 | 1 | ok | 21923 | 26864 | 21922 | 4934 | accepted | 16.7 | 25.9 | 0 | 0 |
| 16 | 2 | 2 | 2 | 2 | ok | 20855 | 25411 | 20854 | 4550 | accepted | 16.7 | 32.5 | 0 | 0 |
| 17 | 0 | 0 | 0 | 0 | ok | 3310 | 7911 | 3309 | 4596 | accepted | 16.7 | 25.3 | 0 | 0 |
| 18 | 1 | 1 | 1 | 1 | ok | 13010 | 15021 | 13009 | 2005 | accepted | 16.7 | 25.5 | 0 | 0 |
| 19 | 2 | 2 | 2 | 2 | ok | 37094 | 40080 | 37092 | 2981 | accepted | 16.7 | 41.2 | 1 | 0 |
| 20 | 4 | 4 | 4 | 4 | ok | 85124 | 85673 | 85123 | 544 | accepted | 16.7 | 47.9 | 2 | 0 |
| 21 | 1 | 1 | 1 | 1 | ok | 5014 | 11017 | 5013 | 6000 | degraded | 16.7 | 25.9 | 0 | 0 |
| 22 | 2 | 2 | 2 | 2 | ok | 38329 | 40597 | 38327 | 2262 | accepted | 16.7 | 26.5 | 0 | 0 |
| 23 | 4 | 4 | 4 | 4 | ok | 62811 | 65438 | 62810 | 2622 | accepted | 16.7 | 63.8 | 1 | 0 |
| 24 | 0 | 0 | 0 | 0 | ok | 5086 | 11088 | 5085 | 5999 | degraded | 16.7 | 26.2 | 0 | 0 |
| 25 | 2 | 2 | 2 | 2 | ok | 41294 | 45164 | 41292 | 3865 | accepted | 16.7 | 27.4 | 0 | 0 |
| 26 | 4 | 4 | 4 | 4 | **FAILED** | n/a | 90003 | 90005 | — | — | 16.7 | 20.7 | 0 | 0 |
| 27 | 0 | 0 | 0 | 0 | ok | 3956 | 6760 | 3954 | 2798 | accepted | 16.7 | 17.5 | 0 | 0 |
| 28 | 1 | 1 | 1 | 1 | ok | 26810 | 29563 | 26809 | 2746 | accepted | 16.7 | 18.2 | 0 | 0 |
| 29 | 4 | 4 | 4 | 4 | **FAILED** | n/a | 90006 | 90004 | — | — | 16.7 | 22.2 | 0 | 0 |
| 30 | 0 | 0 | 0 | 0 | ok | 4796 | 5747 | 4794 | 946 | accepted | 16.7 | 17.2 | 0 | 0 |
| 31 | 1 | 1 | 1 | 1 | ok | 18221 | 20700 | 18220 | 2471 | accepted | 16.7 | 22.5 | 0 | 0 |
| 32 | 2 | 2 | 2 | 2 | ok | 35597 | 39494 | 35596 | 1945 | accepted | 16.7 | 18.5 | 0 | 0 |
| 33 | 0 | 0 | 0 | 0 | ok | 3801 | 9528 | 3800 | 5722 | accepted | 16.7 | 17.4 | 0 | 0 |
| 34 | 1 | 1 | 1 | 1 | ok | 22874 | 27076 | 22873 | 4195 | accepted | 16.7 | 17.6 | 0 | 0 |
| 35 | 2 | 2 | 2 | 2 | ok | 52808 | 56355 | 52807 | 3541 | degraded | 16.7 | 22.8 | 0 | 0 |
| 36 | 4 | 4 | 4 | 4 | ok | 83619 | 86246 | 83618 | 2622 | accepted | 16.7 | 31.3 | 0 | 0 |
| 37 | 1 | 1 | 1 | 1 | ok | 13644 | 19648 | 13643 | 6001 | degraded | 16.7 | 20.4 | 0 | 0 |
| 38 | 2 | 2 | 2 | 2 | ok | 58916 | 63089 | 58913 | 4168 | accepted | 16.7 | 32.3 | 0 | 0 |
| 39 | 4 | 4 | 4 | 4 | **FAILED** | n/a | 90003 | 90001 | — | — | 16.7 | 19.0 | 0 | 0 |
| 40 | 0 | 0 | 0 | 0 | ok | 6370 | 8770 | 6368 | 2397 | accepted | 16.7 | 22.2 | 0 | 0 |
| 41 | 2 | 2 | 2 | 2 | ok | 29089 | 34017 | 29088 | 4920 | accepted | 16.7 | 17.6 | 0 | 0 |
| 42 | 4 | 4 | 4 | 4 | ok | 8157 | 14162 | 8155 | 6002 | degraded | 16.7 | 18.5 | 0 | 0 |
| 43 | 0 | 0 | 0 | 0 | ok | 3119 | 6589 | 3117 | 3464 | accepted | 16.7 | 19.1 | 0 | 0 |
| 44 | 1 | 1 | 1 | 1 | ok | 21449 | 22784 | 21447 | 1329 | accepted | 16.7 | 17.5 | 0 | 0 |
| 45 | 4 | 4 | 4 | 4 | ok | 62808 | 65146 | 62807 | 2334 | accepted | 16.7 | 20.5 | 0 | 0 |
| 46 | 0 | 0 | 0 | 0 | ok | 3693 | 9658 | 3691 | 5960 | accepted | 16.7 | 20.3 | 0 | 0 |
| 47 | 1 | 1 | 1 | 1 | ok | 22698 | 24499 | 22696 | 1795 | accepted | 16.7 | 26.7 | 0 | 0 |
| 48 | 2 | 2 | 2 | 2 | ok | 37057 | 41465 | 37056 | 4403 | accepted | 16.7 | 26.0 | 0 | 0 |

---

## What the contention actually falls on

**The narrative call, not the extraction.**

| width | call 1 (narrative) median (min–max) | call 2 (extraction) median (min–max) | call 1 aborted | call 2 aborted |
|---|---|---|---|---|
| 0 | 4 794 (3 117–6 997) | 2 881 (946–5 999) | 0 / 12 | 1 / 12 |
| 1 | 18 220 (5 013–26 809) | 2 746 (1 329–6 001) | 0 / 12 | 3 / 12 |
| 2 | 37 056 (20 854–58 913) | 2 981 (589–4 920) | 0 / 12 | 0 / 12 |
| 4 | 62 807 (5 208–85 123) | 2 622 (544–6 002) | **4 / 12** | 3 / 8 |

Call 1 tracks the turn's TTFT to within a millisecond at every width. Call 2
does **not** degrade with burst width — it is a small generation (0.5–6 s) whose
prompt prefill is only ~1 s, and it starts after the narrative is already in
flight, so by then the runtime is committed.

The four call-1 aborts at width 4 are the four failed turns, and they landed at
**90 003 / 90 003 / 90 006 / 90 003 ms** — that is `GATEWAY_FETCH_TIMEOUT_MS`
(`packages/frontend/ai-gateway/src/lib/sse.ts:12`, 90 s) firing, not the
dialogue service's own 120 s budget. At width 4 the player's dialogue can be
killed by a transport-level timeout created by a background prefetch.

> **A measurement caveat, stated because it changes how "TTFT" should be read
> here.** On this route the narrative is **not streamed**: the adapter sets
> `stream = resolution.provider !== 'ollama'`
> (`text_adapter_openai_compatible.ts:354`, with the reason in the comment at
> line 350), so `/api/chat` answers `stream: false` and the whole narrative
> arrives as one buffered body. "TTFT" in this table is therefore the narrative
> call's completion time, and it equals call 1's duration. It is the right
> number to compare across widths — it is what the player waits for before
> anything appears — but it is not a token-level time-to-first-token.

---

## Background work

| width | bg calls | per-call median (min–max) | burst span median (min–max) | prompt tok | completion tok | prefill ms | generation ms | model load ms | aborted | failed |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 12 | 13 993 (8 125–21 253) | 17 182 (8 125–21 253) | 11 016 | 8 414 | 583 | 168 961 | 15 | 0 | 0 |
| 2 | 24 | 23 822 (7 837–54 027) | 31 680 (16 866–54 029) | 21 804 | 19 544 | 1 280 | 395 087 | 27 | 0 | 0 |
| 4 | 48 | 45 550 (8 035–90 003) | 80 012 (58 811–90 005) | 38 401 | 37 855 | 3 669 | 752 573 | **17 043** | **5** | 0 |

Two things in that table are not latency:

- **17 043 ms of model load at width 4.** A width-4 sample runs long enough that
  the resident model is evicted and reloaded mid-burst (a width-4 background
  request hit the 90 s fetch ceiling and the runtime reloaded). This is
  background work buying a 17 s load on a machine that already had the model
  warm before the sample began.
- **5 aborted background requests at width 4**, all of them discarded provider
  time that produced nothing — work spent and thrown away.

Background work is otherwise reliable: **0 failed requests at every width**, and
the burst's throughput degrades exactly as a single-runtime queue should
(13 993 → 23 822 → 45 550 ms per call, burst span 17 182 → 31 680 → 80 012 ms).
Doing 4 of them at once costs roughly 4× what 1 costs, in wall clock, for the
same total work. That is the whole argument for bounding it: the burst is not
buying parallelism, it is buying latency.

---

## Frame time

| width | rAF interval median (min–max) | max interval median / worst | slow frames (>2× median), median / worst | `longtask` entries |
|---|---|---|---|---|
| 0 | 16.7 (16.7–16.7) | 22.2 / 26.2 | 0 / 0 | **0** |
| 1 | 16.7 (16.7–16.7) | 22.5 / 42.4 | 0 / 1 | **0** |
| 2 | 16.7 (16.7–16.7) | 26.0 / 41.2 | 0 / 1 | **0** |
| 4 | 16.7 (16.7–16.7) | 24.6 / 63.8 | 0 / 2 | **0** |

**The client's main thread is not affected.** Across 48 turns, with up to four
background inferences saturating the GPU, the browser's animation frame cadence
was a flat 16.7 ms median at every width, the worst single frame anywhere in the
run was 63.8 ms, and the page reported **zero long tasks in 48 of 48 samples**.

This is the answer to "does local concurrency hide a frame-time regression", and
the honest form of the answer is narrower than the question:

- **What is measured:** main-thread availability of the client process while a
  dialogue turn is in flight — the gap between `requestAnimationFrame` callbacks
  and the page's own `longtask` entries, over exactly the turn window at every
  width.
- **What is not measured:** scene complexity, draw calls, or a player moving
  through a map. The benchmark page holds a static map with no input, so this is
  not a gameplay frame time and is not presented as one.
- **Why not the engine's own counter:** the engine already computes one —
  `createPixiApp` maintains a rolling `frameDurationMs` and `fps` from a ticker
  callback and returns them as `PixiAppInstance.debug`, documented as readable
  "from any consumer". It is not readable: `GameWorld.initialize` keeps
  `pixiInstance.app` and discards `debug`. Plumbing it through would be a product
  change, and this is a measurement PR, so the platform's own primitives are used
  and the discarded counter is reported as a gap.

Given the measured zero long tasks and a flat 60 fps median, a *gameplay* frame-time
probe is very unlikely to find anything, and building a profiler to find that out
would be exactly the speculative expansion #382 warns against.

---

## Queueing, and a defect in the client's own telemetry

### Client-side queueing is not observable, and the counter that claims otherwise is inert

`TextTelemetrySpan.queueDepth` and `TextTelemetryCounters.maxQueueDepth` exist
and are documented, but **no product code assigns `queueDepth`**. The only
non-test reference outside the type declarations is the summary reader
(`text_telemetry_service.svelte.ts:217`). So `maxQueueDepth: 0` in every run
above is **structurally zero, not a measurement** — recorded here as `unknown`.

What *can* be said about queueing, measured: the gateway's own accounting puts
it at nothing. Client wall clock minus the provider's own `total_duration` was
**11–12 ms across a 40.8 s, six-request concurrent batch (S5)**, and 2 ms for a
single call. There is no client-side admission queue to find; the queue is
Ollama's, inside the provider, and its cost shows up as the inflated
`eval_duration` of the interactive call.

### 🔴 The client's own per-call latency is wrong for every structured call

The client's telemetry buffer, read at the end of the uncontended context run:

| task | calls | client-reported `medianTotalMs` | client-reported p95 |
|---|---|---|---|
| `dialogue` (call 1, streamed path) | 5 | **4 726** | 6 460 |
| `envelope` (call 2, structured) | 5 | **0** | **0** |
| `summarization` (structured) | — | **0** | **0** |
| `untasked` (structured) | 45 | **0** | **0** |

Every structured call is recorded as instantaneous. The cause is one line, in
three places: `extractStructure` calls
`span({ start: performance.now(), … })` **after** its await
(`text_generation_service.svelte.ts:627, 662, 681`), so
`totalMs = performance.now() - start` rounds to `0`. `streamChat` captures
`start` before the call and is correct, which is why only the streamed task has a
plausible number.

Consequences: the client's "AI activity" view under-reports every envelope,
every NPC-memory refresh and every agent structured call as free; the
per-task latency summary the #410 telemetry added cannot answer "how long does
call 2 take"; and this harness had to take per-call durations from the wire
instead. **This measurement was not made with a broken instrument — it was made
with a different one — but it is a real defect and the smallest concrete fix
available in #382 right now.** It is not fixed here, because a measurement PR
should not change the code it is measuring.

---

## #415 was active — verified, not assumed

The whole point of the re-measurement is the state *after* #415, so it is
checked on the wire rather than inferred from the source:

| | call 2 (`envelope`) | call 1 (`dialogue`) |
|---|---|---|
| requests carrying `think: false` | **12/12, 12/12, 12/12, 8/8** (widths 0/1/2/4) | 0 |
| requests carrying `reasoning_effort` | 0 | 0 |
| requests carrying no reasoning field | 0 | **48/48** |

The 4 width-4 samples with no call 2 are the 4 that failed on call 1 first, so
there was no extraction to check. Every extraction that reached a response
carried `think: false`, and the narrative carries nothing — which is exactly the
contract: `envelope` opts out, `dialogue` deliberately does not.

The envelope path is healthy in this run, on both sides of the burst:

| width | extraction accepted | degraded | turn failed | AI-authored choices | deterministic `talk/leave` fallback | command extracted | command denied by preconditions |
|---|---|---|---|---|---|---|---|
| 0 | 9 | 3 | 0 | 8 | 4 | 0 | 6 |
| 1 | 9 | 3 | 0 | 9 | 3 | 0 | 2 |
| 2 | 11 | 1 | 0 | 10 | 2 | 1 | 6 |
| 4 | 5 | 3 | 4 | 4 | 4 | 0 | 2 |

The uncontended P1 turns agree (4 accepted / 1 degraded of 5, 2 AI-authored choice
sets, 2 commands denied by preconditions). **Degradation is schema rejection, not
timeout** — the three width-0 degradations are the `{"kind":"offerQuest"}`-style
outputs #415 already documented. The extraction did not regress to
near-universal timeout, so the baseline is valid and the experiment stands.

---

## Outcome

> ### B — even width 1 is harmful
>
> Not A (there is a large, same-sign, non-overlapping effect), not C (width 1 is
> not "acceptable" — it is a 4.5× TTFT increase and 11 of 12 samples slower than
> every control sample), and not D (n=12 per width, every sample valid, every
> overlap proven by two independent sources).
>
> **A `max concurrency = 2` bound would fix nothing.** The problem exists at
> width 1, where there is nothing to bound. What the data supports is
> **admission control**: do not start background work while interactive work is
> in flight.

### Where the correctness protections live today

Relevant to any scheduling change, and located here rather than assumed:

- **Staleness / late results:** `_refreshOpener` and `_digest` capture `epoch`
  and the record identity, and drop the result if either moved
  (`npc_memory_service.svelte.ts`). `hydrate` bumps the epoch, so a checkpoint
  or save restore during a burst invalidates its results rather than letting them
  land late.
- **Duplicate mutations:** `_prefetching` (per NPC), `NPC_MEMORY_PREFETCH_COOLDOWN_MS`
  (per NPC), `_enqueue` (per NPC, serialised).
- **Campaign isolation:** `_syncCampaign` clears records and bumps the epoch on
  campaign change; the prefetch only ever reads `_getRecord`, which is
  campaign-scoped.
- **⚠️ All of these are per-NPC.** Nothing is scoped across NPCs, which is the
  fan-out this report measures.

---

## Proposal only — the smallest mechanism the evidence supports

**Not implemented here.** This PR is measurement; the after-state must not
destroy the reproducible before-state.

**Recommended: an interactive/background admission gate in the layer that
already resolves every call, keyed on the field that already exists.**

1. **Use `TextTaskPreset.priority`.** It is already declared
   (`'interactive' | 'background'`, `text_task.ts:60`), already correct
   (`envelope` and `dialogue` are `interactive`; `summarization` is
   `background`), and **consumed nowhere** — verified by searching every
   non-test reference in `apps/frontend/client/src` and `packages/frontend`. So
   the contract is already there and unwired. This is the "improve existing
   mechanisms" path #382 asks for, not a new orchestrator.
2. **Place it in `TextGenerationService`**, which already owns a stream count and
   an abort-controller set, and which every AI surface — dialogue, envelope,
   memory, agents — goes through. A new `GlobalAiSchedulerService` would be a
   second orchestrator next to one that already exists.
3. **Semantics: hold background admission while any interactive call is in
   flight, and release when the last one settles.** Width 1 is the harmful case,
   so the bound has to be *zero concurrent background calls while interactive
   work is active*, not a semaphore.
4. **Admission, not cancellation.** An Ollama request already executing keeps
   consuming the GPU after the client aborts, so aborting a background call does
   not give the interactive call its time back. The win only comes from *not
   starting* the background work. Aborting a queued (not yet started) background
   call is fine and worth doing; aborting a running one is not a lever.
5. **Bound the background burst separately anyway.** Sequential background
   refreshes cost 45 s for four at width 4 versus 14 s for one. If the gate is
   ever relaxed, `NPC_MEMORY_MAP_PREFETCH_LIMIT` is the knob, and it is already
   a constant.
6. **Starvation is a real risk and is why this is not "just defer to idle".** A
   gate with no release-on-idle starves memory refreshes on a player who talks
   constantly. Needs a fairness rule (e.g. at most one background call admitted
   per quiet period) and must be measured again afterwards.

**Rejected, with reasons:**

- **A `max concurrency = 2` semaphore** — the effect is present at width 1.
- **Aborting background requests when a dialogue starts** — HTTP abort is not
  compute preemption; the GPU work continues.
- **Raising the 90 s fetch timeout** — moves the failure, does not remove the
  85-second wait behind it.
- **A new global scheduler** — `TextGenerationService` is the layer that already
  owns this decision for every call surface.

### Also proposed (separate, small, and not speculative)

**Fix the structured-call `totalMs`.** Capture `start` before the await in
`extractStructure` (`text_generation_service.svelte.ts:627, 662, 681`). It is a
few lines, it restores the per-task latency data the #410 telemetry was added to
provide, and it needs no behaviour decision. It is the only change in this report
that is a *correctness* fix rather than an optimisation.

---

## #382 acceptance matrix

| criterion | status after this PR | evidence / gap |
|---|---|---|
| Reproducible before/after report: task latency, calls, tokens, cache, cost, quality | **partial** | This report: 48 real production turns, per-call latency, request counts, prompt/completion tokens, provider phase counters, cache-layer counts, extraction/choice/command outcomes. **No cost figure** (local provider, no price) and **no narrative-quality assessment** — quality is judged here only as schema-validity and command-precondition survival, which is not the same as prose quality. |
| Explicit routing, disabled roles and privacy/cost settings honoured on every path | **not assessed here** | Routing is recorded per run (`ollama` / `ornith-1.5:9b` / native `/api/chat`, 100 % of requests) and confirmed stable. Disabled roles, privacy and cost settings are untouched by this slice. |
| One deadline per logical request; cold load, queueing or retries cannot silently extend it | **partial — a real finding** | The envelope budget stayed at 6 000 ms and no retry occurred. But at width 4 the **narrative** is killed by `GATEWAY_FETCH_TIMEOUT_MS` (90 s) inside the gateway, *before* the dialogue service's own 120 s budget — a second, transport-level deadline that is not the contract's. Worth reconciling. |
| Dependency-safe parallelism exercised under cancellation, partial failure and slow providers | **not assessed here** | This slice measures a production background burst against a player-visible call — one real parallel shape. Cancellation, partial failure and retry paths are not exercised. |
| Background results cannot corrupt newer state, cross campaigns or duplicate mutations | **assessed by inspection, unchanged** | `epoch` + record-identity guards, per-NPC `_prefetching`, cooldown, `_enqueue`, and campaign-scoped reads. **All per-NPC**; nothing bounds the cross-NPC burst this report measures. |
| Cache correctness across schema/model/prompt/state/rules/language, scope, eviction, cancellation, invalidation | **not assessed here** | `cacheHits` are reported (`none` 50, `in-flight-dedup` 5, `exact-result` 0, `provider-prompt-cache` 0 — unobservable on this route). The correctness *tests* criterion is untouched. |
| Agent invocation reductions verified against production call sites | **not assessed here** | Out of scope for this slice. |
| Local concurrency evaluated with gameplay/rendering; no hidden frame-time regression | **partial — now measured, and negative** | 48 samples: 16.7 ms frame median at every width, worst single frame 63.8 ms, **0 long tasks in 48/48**. Measured on the client main thread during a real turn, not during gameplay movement — a gameplay-specific probe is not justified on this evidence. |
| Combat offline fallback, perception limits, revision checks, replay invariants intact | **unchanged** | No combat or engine code was touched; the diff is the measurement harness and this document. |
| Default UX simple; no surprise downloads, spending or mandatory providers | **held** | No product change. The measurement is not reachable in production: the seam installs only when `getPublicMode() !== 'production'`. |
| Each PR: measured benefit or a concrete correctness fix, regression evidence, rollback behaviour; stop speculative optimisation when no bottleneck is demonstrated | **held** | Measurement only, and it demonstrates a bottleneck. Rollback is a revert of the harness; no runtime behaviour depends on it. |

**#382 stays open.** Two of the criteria above are not assessed at all, three are
partial, and the one that is now fully evidenced — local concurrency — points at
a real, unfixed harm.

---

## Reproduction

```bash
# the client dev server and a reachable text provider are required
bun run herdr:start client

# the full report: synthetic scenarios, uncontended dialogue turns, and the sweep
bun run --cwd apps/e2e bench:ai-baseline \
  --label 382-contention-remeasure \
  --skip-cold --reps 5 --p2-reps 12 --p2-widths 0,1,2,4

# a sweep cut short continues from its per-sample checkpoint; the same
# --p2-widths and --p2-reps are required and a mismatch is refused
bun run --cwd apps/e2e bench:ai-baseline \
  --label 382-contention-remeasure \
  --p2-only --p2-resume --p2-reps 12 --p2-widths 0,1,2,4

# the uncontended S1–S5 + P1 context run
bun run --cwd apps/e2e bench:ai-baseline \
  --label 382-contention-context --skip-cold --reps 5 --no-contention
```

`--p2-reps` is samples **per width**; the total is `widths × reps`. Raw
per-sample JSON and the checkpoint live under
`.evidence/382-baseline/<label>/`, which is gitignored and never published.

## Environment traps hit while doing this

Both are recorded because both cost real time and neither is a code bug:

- **The model store was already warm** on this machine; `ornith-1.5:9b` was
  present and no pull was needed. Had it been missing, the symptom would have
  been "the text provider is not reachable at …/v1/models", which reads like a
  routing failure and is not one.
- **No `.env.emulator.local` exists here**, so the `PUBLIC_ASSETS_BASE_URL`
  trap that produced a `/emberwatch/manifest.json` 404 in earlier work did not
  apply. No local config was created, moved or altered, and nothing needs
  restoring.
