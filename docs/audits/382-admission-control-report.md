# Issue #382 — Priority-aware inference admission, measured on the production path

**Status:** implementation + measurement.
**Base:** `main` at `fb8f9a5885debefce78692dfefd3d391aea303e0` (the #416 merge).
**Branch:** `perf/382-inference-admission`.
**Harness:** `bun run --cwd apps/e2e bench:ai-baseline` — the same harness, the same
counterbalanced order and the same client/probe code as
[`382-contention-remeasure-report.md`](382-contention-remeasure-report.md), extended
with an admission ledger and one new scenario.
**Measured:** 2026-10-01. 48 real dialogue turns (12 per width) plus 8 residual
turns, one local machine.

> **The #416 report is the BEFORE state and is not modified by this one.** Every
> "before" number below is quoted from it. Raw per-sample JSON lives under
> `.evidence/382-baseline/` (gitignored, regenerable).

---

## Headline

**The `MAP_LOADED` contention is fixed, and the fix is admission rather than
concurrency limiting.**

Dialogue TTFT is now **flat across background widths** — 5 158 / 3 867 / 4 823 /
4 936 ms at widths 0 / 1 / 2 / 4, with **zero turn failures at every width**.
#416 measured the same scenario at 4 796 / 21 449 / 37 094 / 62 811 ms with
**4 of 12 turns failing outright** at width 4.

| width | #416 TTFT median | **after TTFT median** | #416 failures | **after failures** |
|---|---|---|---|---|
| 0 | 4 796 | **5 158** | 0 | **0** |
| 1 | 21 449 | **3 867** | 0 | **0** |
| 2 | 37 094 | **4 823** | 0 | **0** |
| 4 | 62 811 | **4 936** | **4 / 12** | **0 / 12** |

TTFT no longer scales with requested width at all. In #416 the ratio against the
control was 1.00× / 4.47× / 7.73× / 13.10×; here it is 1.00× / **0.75×** /
**0.93×** / **0.96×**. Width 1 measuring *faster* than the control is run-to-run
variance on a warm machine, not a claim that background work helps.

The mechanism is visible directly in the ledger: at every width,
**0 background requests reached the provider before dialogue started**, and
**0 background requests were in flight when the player began speaking**.

---

## Before — #416, quoted

48 turns, 12 per width, same machine class. Classification **B: even one
background summarization is harmful.**

| width | valid | bg calls (wire) | in-flight at dialogue start | TTFT median (min–max) | wall median (min–max) | failures |
|---|---|---|---|---|---|---|
| 0 | 12/12 | 0 | 0 | 4 796 (3 119–7 000) | 8 365 (5 747–11 483) | 0 |
| 1 | 12/12 | 12 | 12 | 21 449 (5 014–26 810) | 22 143 (11 017–29 563) | 0 |
| 2 | 12/12 | 24 | 24 | 37 094 (20 855–58 916) | 40 080 (25 411–63 089) | 0 |
| 4 | 12/12 | 48 | 48 | 62 811 (5 209–85 124) | 65 146 (11 211–86 246) | **4 turns failed** |

11/12 width-1 samples were slower than the slowest control sample; 12/12 at
width 2. Browser frame cadence held at ~16.7 ms with zero long tasks in all 48
samples, so the bottleneck was inference-resource contention, not rendering.

---

## After — admission enabled

48 turns, 12 per width, **12/12 valid at every width**. Identical counterbalanced
Latin-square order, identical NPC pool, identical model and runtime.

**Environment** (recorded by the harness, not asserted):

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 4090 Laptop GPU, 16 376 MiB |
| Runtime | Ollama 0.34.3 |
| Model | `ornith-1.5:9b`, Q4_K_M |
| Endpoint | `http://localhost:11434/v1` (Ollama native) |
| Commit | `d289ed02b` |

### The player-visible path

| width | valid | bg calls on provider before dialogue | bg spans (client) | **in-flight at dialogue start** | TTFT median (min–max) | wall median (min–max) | failures |
|---|---|---|---|---|---|---|---|
| 0 | 12/12 | 0 | 0 | **0** | 5 158 (3 400–9 594) | 8 479 (5 045–15 106) | 0 |
| 1 | 12/12 | **0** | 12 | **0** | 3 867 (3 192–7 185) | 8 692 (3 905–11 766) | 0 |
| 2 | 12/12 | **0** | 24 | **0** | 4 823 (2 599–6 522) | 8 669 (5 994–12 319) | 0 |
| 4 | 12/12 | **0** | 48 | **0** | 4 936 (3 477–6 582) | 9 091 (5 706–11 775) | 0 |

Wall clock is flat too (+0 % / +4 % / +2 % / +7 % against width 0), where #416
saw +165 % / +379 % / +679 %.

### The admission ledger — where the background work went instead

| width | bg queued after burst | bg admitted before dialogue | **bg in-flight at dialogue start** | queue depth max | bg queue wait ms (min–max) | bg drain ms after turn (min–max) | bg dropped |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 0 | **0** | 0 | n/a | 0 (0–0) | **0** |
| 1 | 1 | **0** | **0** | 0 | 10 203 (5 408–13 277) | 16 414 (10 464–26 416) | **0** |
| 2 | 2 | **0** | **0** | 1 | 13 819 (7 496–35 194) | 39 093 (27 432–48 060) | **0** |
| 4 | 4 | **0** | **0** | 3 | 35 808 (7 210–92 060) | 90 887 (62 154–105 868) | **0** |

> The queue-wait column counts **every** waiting call, not the first per sample.
> An earlier version of this harness kept only the first positive `queueMs` per
> sample, which reported 10 480 / 10 826 ms at widths 2 / 4 and capped the width-4
> maximum at 13 294 ms. The true distribution reaches 92 060 ms, because the
> fourth queued call waits for three predecessors. The figures above are
> recomputed from the same per-sample JSONL the run wrote; no re-measurement was
> needed, and no other number in this report depends on the fix.

Reading it:

- **Every** background request was queued (`bg queued after burst` = the requested
  width) and **none** of them reached the provider before dialogue started.
- **None** were dropped. Across all 48 samples: **0 dropped**, and the client
  recorded **84/84 background spans with `ok: true`**. The work is retained, not
  discarded — a dropped refresh would silently lose a memory write.
- `queue depth max` is the admission gate's own FIFO evidence. At width 4 it is
  exactly **0, 1, 2, 3** in every sample: one at a time, strict arrival order.
- The cost is real and is not hidden: background drain after the turn grows from
  16 s at width 1 to **91 s at width 4**. Best-effort work genuinely waits.

### Scenario A acceptance, point by point

| # | criterion | result |
|---|---|---|
| 1 | interactive TTFT materially restored toward width-0 | **yes** — 3 867–5 158 ms at every width |
| 2 | width 1/2/4 no longer scale ~4×/8×/13× | **yes** — 0.75× / 0.93× / 0.96× |
| 3 | no 90 s foreground failures | **yes** — 0/48 turns failed |
| 4 | background does not begin while interactive is active | **yes** — 0 in flight at dialogue start, 48/48 |
| 5 | near-simultaneous `MAP_LOADED` gives interactive first refusal | **yes** — 0 admitted before dialogue, 48/48 |
| 6 | queued background drains after foreground stops | **yes** — 84/84 spans `ok`, 0 dropped |
| 7 | background not silently dropped | **yes** — 0 dropped |
| 8 | caller cancellation while queued makes no provider call | **yes** — unit-tested |
| 9 | deadline expiry while queued makes no provider call | **yes** — unit-tested |
| 10 | `cancelAll()` cannot release queued work later | **yes** — unit-tested |
| 11 | #411 in-flight dedup still works | **yes** — regression test + harness span counts |
| 12 | #410 absolute deadline semantics intact | **yes** — admission queues *within* the budget |
| 13 | #415 reasoning behaviour intact | **yes** — see the extraction section |
| 14 | independent contention domains not serialized | **yes** — unit-tested |
| 15 | NPC-memory epoch/staleness protections untouched | **yes** — no NPC-memory file changed |
| 16 | telemetry reports real latency and real queue info | **yes** — see the cross-check |

---

## Scenario B — the case admission cannot fix

**This is not blended with Scenario A.** It is a separate experiment with its own
command, its own samples and its own table.

Deliberately forced: dispatch one real background prefetch, **wait until the
client itself reports it provider-in-flight** (`backgroundActive === 1`), and only
then start the dialogue turn.

| | |
|---|---|
| samples | 8 |
| background proven on the provider before dialogue | **8 / 8** |
| provider overlap observed | **8 / 8** |
| interactive TTFT median (min–max) | **21 924 ms (17 467–38 962)** |
| turn failures | 0 / 8 |

**This reproduces the #416 width-1 penalty almost exactly** — 21 924 ms against
#416's 21 449 ms at width 1, a 2 % difference. Nothing was gained, and nothing
was expected to be.

The reason is the one this issue has to be honest about: **aborting an HTTP
request does not reclaim GPU compute.** Ollama keeps generating for a client that
has gone away, so by the time the player's turn starts the device is already busy
and no client-side policy can make it not busy. Admission prevents background work
from *starting*; it cannot undo work in flight, and this PR does not pretend
otherwise by cancelling anything.

So the honest statement of the boundary is:

> Admission removes the `MAP_LOADED` race entirely. It does not remove a
> contention that has already been created by some other path. If a future change
> admits background work in response to a signal admission does not model, the
> width-1 penalty returns unchanged.

That is a real limitation and a defined seam for the next slice, not a defect in
this one.

---

## Choosing the quiet window

The window is the whole mechanism, so it was measured rather than picked. All
three rows are width 4 — the worst case — on the same machine in the same
session.

| quiet window | valid | bg requests on the provider at dialogue start | **TTFT median (min–max)** | bg queue wait median | bg drain median | dropped | failures |
|---|---|---|---|---|---|---|---|
| 0 ms | 4/4 | **4** | **17 250** (12 379–25 975) | 17 224 ms | 59 618 ms | 0 | 0 |
| **1 500 ms (shipped)** | **12/12** | **0** | **4 936** (3 477–6 582) | 35 808 ms | 88 515 ms | 0 | 0 |
| 5 000 ms | 4/4 | **0** | 4 867 (4 029–6 454) | 12 676 ms | 98 628 ms | 0 | 0 |

What the rows show:

- **0 ms removes the deferral, and the failure comes back.** All four background
  requests reach the provider before dialogue starts and all four are in flight
  when the player speaks: TTFT 17 250 ms, still ~3.5× the control. Note what
  did *not* regress — one-at-a-time serialization still held, so 17 250 ms is
  well below #416's 62 811 ms at width 4. **Both halves of the policy are
  load-bearing**: serialization alone recovers most of the penalty, deferral
  recovers the rest. A concurrency cap is therefore not sufficient either, which
  is the same conclusion #416 reached from the other direction.
- **1 500 ms holds the window through the burst** and buys back the whole
  foreground penalty.
- **5 000 ms buys no measurable additional foreground protection** — 4 867 ms
  against 4 936 ms, a 69 ms difference well inside the width-4 spread
  (3 477–6 582). By 5 s the player has demonstrably already started speaking. It
  only lengthens the drain (98 628 ms against 88 515 ms). That is starvation
  bought for nothing, so it is not the value.

The chosen value is therefore the smallest one that closes the measured race:
long enough to outlast the gap between a map load and a player opening a
conversation, short enough that it does not become the thing being optimised.
1 500 ms is not derived from these three points alone — it is the window that
held at every width across all 48 samples of the reported run, with **0** of 48
turns losing their foreground slot.

**Why not a game-event flag instead.** A `MAP_LOADED`/dialogue flag would be a
tighter signal than a timer, but it would put map and turn knowledge inside the AI
service and would still miss every other interactive onset — combat, persona
creation, a panel that mounts, an agent that happens to be interactive. A quiet
window is driven by inference activity itself, so it covers every consumer
without naming one of them, and it cannot be wrong about a path nobody enumerated.

---

## Telemetry: before and after

### The defect

`extractStructure` built its span with `start: performance.now()` evaluated
**after** the awaited work had finished, while `recordTextCall` derives `totalMs`
as `performance.now() - start`. The clock was read once the clock had finished
running, so every structured call reported its own duration as ~0 ms. #416 found
it because a 4 s provider call was logged as 0.

`streamChat` was never affected; it already captured its start first.

Four unit tests were added and then **verified by mutation**: with the old
`start: performance.now()` restored, all four fail with `Received: 0`, and with
the fix they pass.

### Client telemetry vs the wire — same calls, two independent clocks

Narrative (call 1), median ms, 12 samples per width:

| width | wire | client span | Δ |
|---|---|---|---|
| 0 | 5 274 | 5 304 | +30 |
| 1 | 3 956 | 3 962 | +6 |
| 2 | 4 881 | 4 887 | +6 |
| 4 | 5 022 | 5 024 | +2 |

A structured call that took five seconds now reports five seconds. Before the
fix every one of these was 0.

### Queue telemetry

| width | client-recorded queue wait, median (min–max) | queue depth sequence | `maxQueueDepth` |
|---|---|---|---|
| 1 | 10 203 ms (5 408–13 277) | 0 | 0 |
| 2 | 13 819 ms (7 496–35 194) | 0, 1 | 1 |
| 4 | 35 808 ms (7 210–92 060) | 0, 1, 2, 3 | 3 |

The width-4 maximum of 92 s is not an outlier: it is the fourth call waiting out
three predecessors, one quiet window and roughly three generations' worth of
provider time. That is the price of serialising a four-way burst onto one GPU,
and it is why the drain column above is the honest cost of this mechanism rather
than a footnote.

Queue time is already inside `totalMs` — the critical path a player waits on is
queue plus execution — and is reported again separately so the wait is visible on
its own. A call that never queued carries **no** `queueMs`, which is distinct
from a measured `0` (interactive work) rather than a fabricated one.

A hole found while measuring: a request cancelled or expired **while queued**
originally reported no `queueMs` at all, because only the admitted path reported
one. That reads as "it never queued" rather than "it queued for eight seconds and
was dropped". The gate now reports how a request left the queue on **both**
paths, and the harness counts a dropped request as its own invalid reason.

---

## What the mechanism is

### Contention domain: `provider + endpoint origin`

Scheduling is scoped to the resource that contends, not to all AI globally.

- **Model is deliberately excluded.** Two models served by one Ollama endpoint
  share one GPU, which is the measured failure mode.
- **Paths collapse to the origin.** `/api/chat` and `/v1/chat/completions` on
  one host are two request shapes into **one server process**, and one process
  owns one set of accelerators.
- **The port is kept.** Two Ollama daemons on one host are two devices.
- **Two providers never merge**, even on one host: a provider id names a
  configured route, and two routes on one host may be separate daemons.
- **The on-device task pool is its own domain.** Both it and a local runtime are
  colloquially "local"; only one is the contended GPU.

This is a heuristic about physical devices and the boundary is stated rather than
assumed: same origin ⇒ assumed same process ⇒ assumed same compute; different
origin ⇒ assumed independent.

### Priority classification — pinned

Interactive: `narration`, `dialogue`, `combat-intent`, `combat-ai`,
`combat-narration`, `envelope`, `persona-create`.
Background: `summarization`, all eleven agent tasks, `agent-batch`,
`agent-custom`.

An **untasked** call is `interactive`. An absent classification is not evidence
that work is safe to delay, and deferring an unknown call on a guess would degrade
the game with no author to correct it.

The sets are pinned by test. #416 showed that moving one task between them is a
player-visible latency change that nothing else in the suite would catch.

### The policy

1. Interactive is admitted **immediately** and never gated. Admission adds
   nothing to the player's latency; it only declines to start background work
   under it.
2. Background **never dispatches synchronously** — not even into a completely
   idle domain. This is the rule that closes the measured race.
3. At most **one** background inference per contention domain.
4. **Strict FIFO** within a class. No LIFO, no randomness, no agent-specific tiers.
5. Queued work stays cancellable; an expired deadline drops it **without**
   reaching local inference, the gateway or the provider.
6. Running background is **never** aborted because interactive arrived.
7. Fairness: once foreground stops and the domain stays quiet, queued background
   **drains**. Continuous foreground may postpone it indefinitely.

### Why deferral, not "queue while interactive is active"

The obvious rule is insufficient, and this is the single most important thing in
the design. Production goes:

```
MAP_LOADED → background summarization STARTS → dialogue begins
```

At that instant nothing interactive is running, so "is interactive active?"
returns false, admits the burst synchronously, and the measured width-1 failure
reproduces exactly. A gate that only tests the present cannot see a request that
is about to exist.

### Where it lives

`TextGenerationService`, which already owns the logical request's lifetime,
caller abort linkage, the one absolute deadline, the local-first decision, the
coalescer and the telemetry. **Inside** the coalescer and **around** the provider
call — never around each subscriber.

That placement is the #411 trap. Putting the gate at the subscriber edge would
serialize two identical concurrent requests so they were no longer simultaneous
at the coalescer, silently switching deduplication off for exactly the case it
exists for. A regression test asserts two identical concurrent background
requests still produce **one** provider call after waiting out **one** window.

---

## Fairness and starvation — stated, not hidden

The minimum guarantee this PR makes:

> Once interactive activity stops and the contention domain stays quiet for the
> window, queued background work drains and no request is permanently forgotten.

Measured: **0 dropped across 48 samples, 84/84 background spans completed
successfully.**

The deliberate tradeoff: **continuous foreground activity may postpone
best-effort background work indefinitely.** That is the intended behaviour — it
is the whole point of prioritising the player — and it is *not* mitigated with a
max-age escape hatch that force-runs a background call during an active turn,
because that would reintroduce the measured bug by design.

The cost is bounded and visible in the table above: a width-4 map load defers its
refresh by up to ~91 s on this hardware, and the refresh still completes.

**If NPC-memory correctness later requires a stronger progress guarantee under
constant interaction**, that is a separate decision with its own evidence. It has
not been pre-built here, and inventing one now would be exactly the speculative
optimization #382 tells us not to ship.

---

## Local-first is deliberately outside admission

Structured extraction can attempt the local task pool before the configured
gateway. That path is **not** gated here, for two reasons:

1. **Different resource.** The on-device pool names a different provider id and
   therefore resolves to a different contention domain. Merging it with a local
   runtime would serialize a cheap browser path behind a contended GPU for
   nothing.
2. **Not exercised by this measurement.** In the measured configuration the
   seeded Ollama connection has an endpoint, so it resolves to mode `byok` with
   provider `ollama`, and `isLocalRoute` is false — the local attempt is not taken
   at all. Admission therefore governed the configured provider path throughout,
   which is precisely the path #416 demonstrated to contend.

This is recorded as an untested boundary rather than a verified one. Establishing
the local pool's real resource identity on hardware is a separate slice.

---

## Regression checks

| what | result |
|---|---|
| **#415 envelope reasoning** | intact. Extraction still completes inside budget in 44/48 samples; 4 exceeded the 6 000 ms deadline (2 at width 1, 2 at width 2). #415 is not touched by this PR. |
| **extraction acceptance** | 12/12, 7/12, 10/12, 10/12 by width. **Not** a function of admission — no background work was on the provider during any turn. This is the known marginality of a ~4 s extraction against a 6 s budget. Recorded as an open item, not attributed to this change. |
| **#410 absolute deadline** | intact. Admission queues *within* the existing budget; a queued request's wait consumes it, and expiry while queued removes it without a provider call. |
| **#411 coalescing** | intact. Regression test asserts one provider call per pair of identical concurrent background requests. |
| **contention-domain reclamation** | An idle domain is removed from the gate's map once nothing holds it, so the map cannot grow for the lifetime of a session and `recountTotals` cannot scan an unbounded set of user-supplied provider/endpoint strings. Pinned by test in both directions: an idle domain is reclaimed, a domain with a queued waiter or an armed window is not. |
| **#415/#416 frame cadence** | 16.7 ms median at **every** width. Long tasks: 0 / 1 / 0 / 4 across the four widths, max 90 ms, all inside the drain window rather than the turn. #416 recorded zero long tasks at every width, so this is a small, non-zero change and is reported as such rather than rounded to "no regression". |
| **NPC memory** | untouched. Epoch, staleness and campaign-scope protections unchanged; no file under `services/npc` is in this diff. |

---

## Known limitations of this measurement

Stated so the next reader does not have to discover them.

1. **The aggregate wire "call-2 extraction" column is contaminated at width ≥ 1.**
   The harness splits wire rows by a measured time boundary, and admission moves
   background drains to *after* the turn — where they land in the same bucket as
   the extraction. The per-sample rows are correct; the aggregate column is not,
   which is why its median (16–18 s) exceeds the extraction's own 6 s deadline.
   **The client-span extraction column is the trustworthy one** and is what the
   table above uses. This predates this PR; #416 recorded the same caveat about
   its time-boundary split.
2. **One machine, one model, one runtime.** All figures are RTX 4090 Laptop +
   `ornith-1.5:9b` + Ollama 0.34.3, warm, fully resident in VRAM. A CPU-backed
   or differently-served host would produce different numbers and could well
   prefer a different window.
3. **n = 12 per width**, unchanged from #416. Adequate to resolve a 13× effect;
   it is not a substitute for a distribution.
4. **The local-first path was not exercised** (see above).
5. **`report_bundle_budget` fails identically on clean `main`** (`total JS:
   1011 → 4047`). Verified by stashing this branch and re-running: same numbers,
   pre-existing, not introduced here.

---

## Reproducing

```bash
# the client dev server and a reachable text provider are required
bun run herdr:start client

# Scenario A — the width sweep (THE reported run)
bun run --cwd apps/e2e bench:ai-baseline \
  --label 382-admission-after \
  --p2-only --p2-widths 0,1,2,4 --p2-reps 12

# Scenario B — the already-running-background residual experiment
bun run --cwd apps/e2e bench:ai-baseline \
  --label 382-admission-residual \
  --p2-only --p2-widths 0 --p2-reps 1 --residual --residual-reps 8

# quiet-window comparison at width 4
bun run --cwd apps/e2e bench:ai-baseline --label 382-admission-window0 \
  --p2-only --p2-widths 4 --p2-reps 4 --quiet-window-ms 0
bun run --cwd apps/e2e bench:ai-baseline --label 382-admission-window5000 \
  --p2-only --p2-widths 4 --p2-reps 4 --quiet-window-ms 5000
```

`--quiet-window-ms` installs the window through the client's documented
test/measurement seam, so candidate values are comparable within one session and
one machine state. It is unset in production.

The sweep is checkpointed per sample and resumable with `--p2-resume`; the same
`--p2-widths` and `--p2-reps` are required and a mismatch is refused.

---

## Related

- [`382-contention-remeasure-report.md`](382-contention-remeasure-report.md) — the
  BEFORE state, unchanged.
- [`382-envelope-reasoning-control-report.md`](382-envelope-reasoning-control-report.md) — #415.
- [`382-production-path-report.md`](382-production-path-report.md) — #413.
- [`382-next-slice-proposal.md`](382-next-slice-proposal.md) — the triage that
  pointed at this scenario.