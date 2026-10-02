# Issue #382 — gameplay integration acceptance report

**Branch:** `fix/382-gameplay-ai-integration`
**Issue:** [#382](https://github.com/BearlySleeping/aikami/issues/382) — stays open.
**Lane:** A (gameplay integration, freshness, accounting). Lane B owns decision
config/settings; lane C owns the measured decision pilot. Nothing in this report
crosses into either.

**Review this answers:** the post-merge review of `738252d7`, findings 2–8.

---

## 0. What is in this change, in one paragraph

Six defects that all had the same shape — a fact some layer established and a
layer below it never received — are now wired end to end. The caller's absolute
deadline reaches the transport. The route a request was admitted and coalesced
under is the route it is dispatched to. The gateway's per-attempt events are
consumed in production, once per provider bill. A prepared NPC greeting is
revalidated when the player actually sees it. A failed digest gives its
transcript lines back in the order they happened. The reasoning on/off probe ran
against a live runtime. Gameplay-path timings used a simulated adapter, as described in §4.1; they measure client scheduling,
admission and accounting. Live gameplay latency remains unmeasured.

---

## 1. Supported criteria

Criteria below are **supported** because they are enforced by a test that fails
without this change, or measured with a method that is stated and reproducible.

### 1.1 One deadline per logical request, carried to the transport

**Before.** `streamChat` and the structured path built an absolute deadline and
then called the gateway with a bare `signal`. `AiTextGenerationOptions` carried
`deadlineAt`, the adapter honoured it, and nothing in the client ever set it — so
the adapter's historical 90 s safety watchdog applied to *every* call. A dialogue
turn with 120 s available was cut at 90 s, with an error that named a timeout the
player has no way to act on, and the orchestrator's own 120 s budget went unused.

**After.** The absolute instant is computed once per logical request and travels
`streamChat`/`extractStructure` → service → gateway → adapter, where it is adopted
verbatim. Queueing, the local-first attempt, structured repair, empty-body backoff
and retry all draw the same clock down; the separate first-content and idle
watchdogs are unchanged, and so is the no-budget safety fallback for callers that
ask for nothing.

The dialogue orchestrator — which has owned a 120 s budget since C-328 but could
only enforce it with a timer around the promise — now mints one absolute instant
per *turn* and hands it to **both** of the turn's calls.

- `packages/frontend/ai-gateway/src/lib/gateway.ts` — a spent budget is refused at
  the boundary, **above** `onResolve`/`onDispatch`, so no dispatch is announced
  for a call that never left the process.
- `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts`
- `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts`
- `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts`

Regressions: `route_snapshot.test.ts` ("the caller deadline is forwarded to the
adapter unchanged", "a SPENT deadline dispatches nothing at all"),
`text_deadline_and_dispatch.test.ts`, `npc_dialogue_service.test.ts`.

### 1.2 One route per request, resolved once

**Before.** The service resolved a route for admission, built a coalescing
identity and a contention domain from it, and then let the gateway resolve a
*second* time at dispatch. A settings change in between produced a request
admitted against route A, keyed under route A, and dispatched to route B — three
committed facts and one actual call, with nothing recording the disagreement.

**After.** `AiTextGenerationOptions.route` carries the caller's immutable
snapshot. The gateway dispatches it verbatim, does not consult the resolver, and
ignores `model`/`endpoint`/`task` (which are inputs to resolution, not dispatch
parameters). A route that disagrees with an explicit `mode` override is reported
rather than silently half-honoured.

**Policy on revision change: retain a safe snapshot.** A request in flight keeps
the route it was admitted under. It is not retired and not re-bound: retiring
would throw away a queue position the caller already paid for, and re-binding is
precisely the defect. What the revision *does* control is whether a NEW request
may JOIN an in-flight one — a changed configuration means a new key, so the new
request dispatches on the new route and the old one finishes on the old one.
Both are correct; neither is billed under the other's identity.

Regressions: `route_snapshot.test.ts` ("a settings change between resolution and
dispatch cannot move the route", plus the positive control that a request *after*
the change does reach the new provider), `text_deadline_and_dispatch.test.ts`.

### 1.3 An opaque configuration revision, with no secret in the key

**Before.** `configRevision` existed as a parameter and no caller supplied it. The
only identity available was the resolved route, which cannot see a credential
change: rotating an API key while leaving provider, endpoint and model alone
produces a byte-identical route identity, so a request arriving after the
rotation could still join an attempt the previous key is paying for.

**After.** `text_route_revision.ts` derives an opaque marker from the public
`ConfigState` projection and publishes it through `AiGatewayService.routeRevision()`.
`extractStructure` uses it by default; a caller with a stricter notion (a vault
epoch, a server-pushed revision) may supply its own.

**Credentials are interned, not hashed.** A bounded in-process table maps each
distinct credential to an ordinal (`cred-1`, `cred-2`, …) and only the ordinal
enters the revision. Nothing needs reversibility or even a digest; every use is
equality. A digest would have been stable, comparable and loggable — a secret
that survives every boundary a secret is meant to be kept out of — and trivially
reversible at API-key entropy.

**False-different is the safe direction.** Eviction from the interning table, or
an unrelated-but-projected field moving, produces a *different* revision. That
costs one missed dedup and one extra provider call, never a wrong join.

Regressions: `text_route_revision.test.ts` — including "a rotated key produces a
revision that exposes nothing about either key" and "the token contains no part
of the credential and is not its digest".

### 1.4 Attempt accounting consumed in production

**Before.** The gateway emitted per-attempt events through an optional `onAttempt`
and the gameplay service passed neither it nor a stable logical request id. The
telemetry shape had every field for the accounting and nothing to fill it from.
Separately, the buffer credited **one provider attempt to every logical request**,
including local answers, coalesced subscribers and requests dropped from the
admission queue — so a session in which most work was deduplicated reported MORE
attempts than it made.

**After.**

- Every gateway call installs an `onAttempt` sink and carries a stable logical
  request id. The coalescer mints ONE id per shared attempt and hands it to the
  initiator, so a retry and a structured repair are attempts 2 and 3 of one
  request rather than three requests.
- The sink is owned by the caller and read on **both** the success and the failure
  path. A discarded attempt is the one an accounting boundary most often loses,
  and it is the one the provider billed.
- A new `dispatch` field separates the four outcomes the attempt stream cannot
  distinguish from each other: `provider`, `local`, `coalesced`, `suppressed`.
  `counters.attempts` now counts only dispatched provider attempts; `coalesced`
  and `suppressed` are counted in their own right.
- Token provenance is carried verbatim. A runtime that reports no cache counter
  stays `'unknown'`; a measured zero stays `0`. No cost is derived and no cache
  "saving" is inferred from latency.

Regressions: `text_deadline_and_dispatch.test.ts` (three attempts recorded once
with `cachedSource: 'unknown'`; a cancelled attempt still counted; three
subscribers → one attempt and two joiners; a local answer, a joiner and a
suppressed request all cost zero), `text_attempt_projection.test.ts`.

### 1.5 Prepared greetings revalidated at consumption

**Before.** Every opener check happened when the opener was *generated*.
`_refreshOpener` compared the fingerprint before and after its own call, which can
only detect a change that happened *during* the call. Nothing compared the opener
to the world at the instant the player pressed interact — the window is a whole
map walk.

**After.** `resolveGreeting` recomputes what the opener was stamped with and
refuses on any of: no opener, an opener for an earlier conversation, a changed
world fingerprint, a changed persona/prompt revision, or a save that predates the
stamps. Refusal degrades to the **authored** greeting and requests one debounced,
generation-scoped refresh — never an unbounded loop, never a provider call on the
dialogue-opening path.

**Deliberate reuse is preserved, and separated from age.** A greeting whose world
and persona are unchanged is still shown after it ages out; the refresh re-dates
it without asking the provider anything, which is #422's measured behaviour. The
opener max age is a *refresh trigger*, not a display veto — conflating them would
turn every fifteen minutes of play into either a silent suppression or a wasted
call.

The persona revision is new: a shopkeeper whose persona an author rewrote was
still being greeted in the deleted voice, because the world fingerprint cannot
see authored content.

Regressions: `npc_memory_freshness.test.ts` (unchanged → shown, ten consumptions
→ zero extra calls; world moved → authored; persona rewritten → authored; old save
→ authored; five stale consumptions → at most one background refresh).

### 1.6 Digest line restoration is chronological

**Before.** A digest claimed its transcript lines at dispatch and gave them back
on failure. Anything that arrived in between was already in the buffer and is
strictly newer. The give-back *appended*, so the buffer's tail was its oldest
content, and under the cap the slice evicted recent conversation to make room for
a conversation the player had moved past.

**After.** `mergeRestoredDigestLines` puts the claimed lines first and keeps the
newest `limit`.

**Retention policy, stated.** Overflow drops the OLDEST lines, keeping the newest
`MAX_CARRIED_LINES` (2 × `digestTranscriptLines` = 60). This is a deliberate,
bounded loss: a player who talks to one NPC more than sixty lines' worth between
two successful digests loses the beginning of that burst from the next digest's
transcript. The deterministic `fallbackSummary` and `lastExchange` written at
`recordConversation` time still carry the gist. **Nothing here is lossless**, and
this report does not claim it is. What the merge guarantees is that whatever is
retained is in the order it happened.

Regressions: `npc_memory_utils.test.ts` (chronology, overflow, zero limit),
`npc_memory_freshness.test.ts` (older claimed lines precede lines that arrived
during the digest; a 90-utterance burst retains `BURST-089` last, in order).

### 1.7 A 91-second wait preserves campaign, conversation and world validity

Held a digest open across 91 virtual seconds, switched campaign, changed the world
and the persona, and started a second conversation. On release, the old digest's
answer appears nowhere in the new campaign's record — not its summary, not its
opener, not its notes — and the greeting on offer belongs to the world the player
is actually in. Within one campaign, the *memory* is still applied while the
*opener* is withheld: the conversation happened, and losing it because the world
moved would be a worse outcome than a late greeting.

Regressions: `npc_memory_freshness.test.ts`, "a very long queue delay preserves
campaign, conversation and world validity".

---

## 2. Blocked criteria

**Not delivered, with the reason.**

| Criterion | Why blocked | What would unblock it |
|---|---|---|
| End-to-end latency and quality improvement attributable to this change on real hardware | The only runtime reachable from this environment is Ollama 0.34.3, CPU-only, single `ornith-1.5:9b`. No GPU, no second model, no hosted endpoint. | A run of `probe:ai-reasoning-control` and the gameplay path on the GPU box #416 used, with the raw evidence kept. |
| HTTP abort reclaiming model compute | **Not a defect and not claimed either way.** Aborting a client connection stops the client reading the answer; it does not stop Ollama generating. The admission gate is designed around that fact rather than against it. | Nothing — this is a property of the transport, and pretending otherwise is the failure mode. |
| A real player's measured session | No instrumented gameplay session was run. Every gameplay number below is from a client-path simulation or from a direct provider call. | An instrumented session with the telemetry buffer exported. |
| Provider token cost and cache savings | The reachable runtime reports `prompt_eval_count`/`eval_count` but the sampled runs did not return a cached-token counter, so `cachedSource` is `unknown`. | A runtime that supplies `prompt_eval_cached_count`, or a hosted provider with a usage breakdown. **No figure is estimated in its place.** |

---

## 3. Narrowed criteria

Claims that were previously broader than the evidence supports, now stated at the
width the evidence actually has.

| Criterion | Before | Now |
|---|---|---|
| Reasoning control for bounded background tasks | #422 reported a latency and validity comparison, then withdrew it as unmeasured. | **Measured, and the answer is negative for two of three tasks.** See §4.2. The `summarization` preset's `reasoning: 'none'` is *not* changed on the strength of this run — see §4.3. |
| `MAP_LOADED` background width | Reported as provider-latency rows from a live GPU. | Reported as **client-path** rows: queue wait, dispatch count, contention, frame cadence. Provider time is not in this table and no row here may be read as one. |
| Prompt composition / repeat-hit distribution | Deterministic client-side probes (#422 P1/P2). | Unchanged and still valid — they never claimed provider behaviour. |
| Native transport speedup | #420's width-zero row pooled different prompt lengths. | **Still not established.** Not re-measured here; the equal-prompt comparison remains outstanding. |
| Attempt accounting | "every dispatched attempt" as an available hook. | "every dispatched attempt, consumed in production, once per bill, with joiners and suppressed work counted separately." |

---

## 4. Measurements

### 4.1 The real gameplay/gateway path

`bun run --cwd apps/frontend/client probe:ai-gameplay-path`
Raw evidence: `.evidence/382-gameplay-path/gameplay-path-full.json`
(regenerable, gitignored). Rerun on 2026-10-02 with distinct per-request prompts
in the cold-start and drain scenarios. Client tests ran concurrently in the
same sandbox, so timer gaps include that host load.

> 🔴 **This is a simulation.** The adapter behind the gateway is a timer
> (400 ms service, 60 ms headers). Every number below describes **Aikami's
> scheduling, admission, coalescing and accounting**. None of it is a model
> benchmark and none of it may be quoted as one. A live provider comparison lives
> in a separate file with a separate name, deliberately.

**MAP_LOADED, background width 0/1/2/4, then the player speaks** (quiet window
1 500 ms, dialogue 200 ms after the burst):

| background width | dialogue queue | dialogue total | background dispatched | provider attempts | max frame gap | frames > 32 ms |
|---|---|---|---|---|---|---|
| 0 | 0 ms | 407 ms | 0 | 1 | 21 ms | 0 |
| 1 | 0 ms | 401 ms | 1 | 2 | 21 ms | 0 |
| 2 | 0 ms | 401 ms | 2 | 3 | 20 ms | 0 |
| 4 | 0 ms | 401 ms | 4 | 5 | 20 ms | 0 |

The production sequence is reproduced: the map loads, N remembered NPCs queue
their digests, and the player walks up to someone. **Dialogue time is flat across
the burst width and the dialogue queue is zero at every width** in this
simulation. A 16 ms event-loop timer sampled each width for 2 seconds: 122, 123,
124 and 123 samples respectively (492 total), with zero gaps over 32 ms. This
is timer cadence in Bun, not browser rendering or GPU contention evidence.

**Quiet window** (a dialogue arrives at half the window):

| window | background queue wait |
|---|---|
| 0 ms | 1 ms |
| 500 ms | 1 159 ms |
| 1 500 ms | 2 688 ms |
| 3 000 ms | 4 908 ms |

The window is re-armed by interactive activity, so a mid-window arrival pushes
background *further* out rather than letting it through. That is the intended
behaviour and it is also the reason the window is not a fixed delay.

**Campaign teardown and world mutation with work in flight:** 2 queued units
dropped, **0 orphan dispatches**. The one unit already in flight on the provider
completed. The distinction is the point: queued work is cancellable and must cost
nothing; already-dispatched work may still finish, and this report does not claim
an HTTP abort reclaims model compute.

**Cold start** (first admission on an idle domain vs. warm; distinct prompts
for every request):

| width | cold median | warm median | provider attempts (both bursts) | peak concurrent calls |
|---|---|---|---|---|
| 1 | 402 ms | 404 ms | 2 | 1 |
| 2 | 609 ms | 607 ms | 4 | 1 |
| 4 | 1 006 ms | 1 005 ms | 8 | 1 |

Cold and warm differ by at most 2 ms here; there is no model-loading cost in the
simulated adapter. The one-background-at-a-time rule holds, and the median wait
increases with burst width because distinct requests each consume service time.
The previous identical prompts measured coalescing and could not establish
queue-drain behavior.

**Long context** (200 / 8 000 / 64 000 prompt characters): identical client
scheduling at every size, as it must be. A 100 ms caller budget on a 400 ms call
clamps at **101–107 ms**, with **1 dispatch and 0 completed attempts** — the honest
report of a request that was sent, cost a bill, and was cut. Prompt size changes
provider cost, not client scheduling; this probe does not measure provider cost.

**Queue drain** (6 distinct background prompts, 300 ms window): 6 admitted,
0 dropped, queue wait median **2 053 ms** / max **3 811 ms**, **6 provider
attempts, max 1 concurrent**. The window is applied between serial admissions,
so waiting accumulates across the burst. The 4-second timer window collected
246 samples, with max gap 21 ms and zero gaps over 32 ms. These samples cover the
sampling window, not necessarily the final request's completion. This establishes
serial admission of separate attempts; the previous single-attempt result was
coalescing, not a six-request drain.

**Coalescing** (5 identical subscribers): 5 answered, **1 provider attempt**.

### 4.2 Reasoning on/off, per task, with each task's real schema

`bun run --cwd apps/frontend/client probe:ai-reasoning-control -- --reps 4`
Raw evidence: `.evidence/382-reasoning-control/reasoning-control.json`.

**Configuration.** Ollama 0.34.3, `ornith-1.5:9b` (Q4_K_M), native `/api/chat`,
CPU-only. 4 reps per cell. `status: measured`; 48/48 requests connected.
This table retains the original live run. The 2026-10-02 correction uses the
production opener limit exactly; its quality counts have not been remeasured
against a live runtime.

**Method, stated rather than assumed.** Cold is established by
`POST /api/generate {keep_alive: 0}` followed by `GET /api/ps` confirming absence;
warm by a priming generate followed by `GET /api/ps` confirming residency. A cell
whose condition could not be established would be labelled `unknown`, not `warm`.
Both were established on this run.

**Validation is two-stage and counted separately.** `Value.Check` against each
task's real production schema, and — above it — a task-specific quality gate: a
digest that kept no durable notes, a session summary with fewer than two events,
or an opener that is a verbatim repeat of the previous greeting is a **failure**,
and it is the failure a schema check exists to miss. A runtime that ignores
`think: false` is detected by comparing reasoning characters, not assumed away.

| task | condition | reasoning | connected | schema-valid | quality-valid | median ms | thinking chars | output tokens |
|---|---|---|---|---|---|---|---|---|
| npc-digest | cold | on | 4/4 | 0 | 0 | 10 478 | 1 776 | 600 (capped) |
| npc-digest | cold | **off** | 4/4 | **4** | **4** | **7 164** | 0 | 406 |
| npc-digest | warm | on | 4/4 | 1 | 1 | 10 709 | 1 184 | 600 (capped) |
| npc-digest | warm | **off** | 4/4 | **4** | **4** | **7 462** | 0 | 421 |
| opener-refresh | cold | on | 4/4 | 0 | 0 | 10 448 | 2 275 | 600 (capped) |
| opener-refresh | cold | **off** | 4/4 | **4** | **4** | **4 086** | 0 | 229 |
| opener-refresh | warm | on | 4/4 | 1 | 1 | 11 347 | 1 934 | 600 (capped) |
| opener-refresh | warm | **off** | 4/4 | **4** | **4** | **5 035** | 0 | 240 |
| session-summary | cold | on | 4/4 | 4 | 4 | 6 593 | 353 | 369 |
| session-summary | cold | **off** | 4/4 | **4** | **4** | **5 247** | 0 | 289 |
| session-summary | warm | on | 4/4 | 4 | 4 | 8 945 | 404 | 433 |
| session-summary | warm | **off** | 4/4 | **4** | **4** | **5 156** | 0 | 242 |

**The finding is a quality regression, not a latency trade.** On the digest and
opener tasks, reasoning-on consumed the entire 600-token prediction budget in the
thinking channel and returned **truncated, non-JSON content** in 14 of 16
requests. The other 2 reasoning-on responses were schema-valid and quality-valid.
Reasoning-off returned well-formed, quality-valid output in 16 of 16.

Session-summary is the exception: its thinking stays short enough (353–404
characters) that the answer still lands, and it pays 1.2–1.7× the latency for no
quality gain.

**Caveat that belongs with the number.** `num_predict: 600` is the probe's
budget, and the probe's budget is a variable. A larger budget would let the
reasoning-on responses finish — at higher cost and higher latency, which is the
trade #382 is measuring. What is established here is that under a bounded output
budget sized for a JSON object, reasoning is not merely slower but
output-destroying for two of the three background tasks.

### 4.3 Why no preset was changed

The `summarization` preset already carries `reasoning: 'none'`, so production
behaviour already matches the better-measured column. **This PR does not alter
any preset**, and the reason is not caution for its own sake: changing a shared
preset on the strength of one model, one runtime, one CPU and one output budget
would move every summarization call in the product on the evidence of twelve
samples. The correct next step is a budget sweep — reasoning-on with budgets
sized for reasoning, measuring quality and latency together — and that is a
separate piece of work with its own evidence.

---

## 5. Retired and rejected candidates

### 5.1 Candidate decisions and measurement limits

- **Private cross-NPC prompt aggregation.** One request carrying several NPCs'
  private memory into a single model call. **Rejected.** It merges content the
  player experiences as separate conversations, it makes every NPC's memory
  hostage to the slowest one in the batch, and it produces a single failure
  domain for work that is currently independent. The measured need it addresses
  — background work competing with the foreground — is met by the admission gate
  (§4.1), not by merging the requests.
- **Arbitrary prose result caching** (an exact-result cache over free-text
  answers). **Rejected.** An identical-looking dialogue reply is not an identical
  situation, and a cache that guesses "close enough" replays a stale answer into
  a new scene. #422's repeat-hit distribution found the hit rate too low to pay
  for the risk, and the hits that existed were openers whose semantic inputs
  were unchanged — which the fingerprint check now handles by *re-dating*, with
  no stored model output at all.
- **Application-level batching of MAP_LOADED opener work.** **Deferred pending
  live workload measurements.** The corrected simulation shows that admission
  preserves foreground dispatch while six distinct background requests incur
  six attempts and accumulate up to 3 811 ms of queue wait. It does not establish
  that batching offers no benefit to background latency or provider cost. A
  live comparison must weigh those possible benefits against coordination and
  shared failure handling before closing this candidate.

### 5.2 Rejected for this lane

- **A second inference engine or a bundled managed runtime.** Backend selection
  belongs to lane B and needs packaging/footprint evidence this lane has no way
  to produce.
- **Automatic decision routing.** Lane C, after the settings and evaluation work
  merges. Nothing here should be read as enabling it.

### 5.3 Reconsideration bar

Reconsider aggregation or result caching, and evaluate deferred batching, only
with a **compatible live workload measurement**: evidence that a real session produces concurrent,
same-campaign, semantically-independent NPC turns at a rate that makes merging
them cheaper than the coordination they cost. No such live measurement exists today. Section 4.1 establishes client queue
behavior and leaves the batching comparison open.

---

## 6. Rollout and rollback

**Risk surface.** This changes when requests are dispatched (one route, one
clock), what is recorded (a new `dispatch` field and two new counters on spans),
and when a greeting is shown (a revalidation that can refuse an opener the
previous build would have displayed). The digest carry-forward merge changes the
*order* of lines in a bounded buffer, not their content.

**Rollout.** No feature flag and no migration. `route` and `routeRevision` are
additive gateway options; `deadlineAt` was already additive; the
`dispatch`/`coalesced`/`suppressed` telemetry fields are optional and absent on
spans recorded by older callers; `promptRevision` is an optional save field and a
save without it simply refreshes its openers once.

**Behaviour a user could notice, and the honest description.**

1. A dialogue turn on a slow local model can now run to 120 s instead of being
   cut at 90 s. That is the intended fix; a player on a very slow machine may
   wait longer before a turn fails, and the failure still surfaces as a failed
   turn state with a reason.
2. A prepared greeting is refused when the world or the persona moved since it
   was generated. The player sees the authored line for that one approach, and
   the prepared line returns on the next approach. This is strictly more correct
   and slightly less polished in the gap.
3. An aged-out greeting is still shown (unchanged from #422) because its inputs
   are unchanged; the max age triggers a background re-date, not a suppression.
4. Request accounting is stricter. `counters.attempts` will read LOWER than it
   did before, because local answers, joiners and suppressed requests no longer
   contribute a phantom attempt. That is a correction, not a regression.

**Rollback.** Revert the merge commit. There is no persisted state whose meaning
changes on rollback except `promptRevision` on saved openers, which is ignored by
a build that does not read it. No vault migration, no cache to clear, no server
state to reconcile.

**If a rollback is not possible in time:** the two highest-risk items are
independently disableable at runtime — the greeting revalidation is a single
predicate (`_revalidateOpener` returning `undefined`), and the strict attempt
counting is one `dispatchedAttempts` helper. Both can be made permissive without
touching the deadline or route wiring.

---

## 7. Validation performed

Original implementation results (before the 2026-10-02 review corrections):

| Check | Result |
|---|---|
| `moon run client:test` | 4 570 pass, 0 fail, 7 skip, 2 todo (345 files) |
| `moon run frontend-ai-gateway:test` | 507 pass, 0 fail (27 files) |
| `moon run client:typecheck` | 0 errors, 0 warnings |
| `moon run schemas:test`, `moon run schemas:typecheck` | pass |
| Biome check (`--error-on-warnings`) | clean |
| Structural guards | 10/10 pass; two baselines **shrank**, none raised |

Probes are run manually and their output lands in `.evidence/` (gitignored,
regenerable). Neither probe is a test and neither is wired into CI. The reasoning-control
probe needs a live runtime; the gameplay-path probe uses a simulated adapter.
A failed or unavailable probe is recorded as
`blocked` with its reason and exits non-zero — it is never reported as a pass.

---

## 8. File count

**40 files**, of which 8 are new and 32 are modified. The review asked for
60–85 and set 99 as a hard maximum.

The gap is scope, not omission. The requested work is an integration across four
surfaces that already existed, and the honest file count for it is what it is.
The alternatives were all forms of inflation the review explicitly ruled out:
filler modules, tests split across files to reach a number, or touching
unrelated translations.

Eight of the 40 are modules that had to be EXTRACTED, not features added. Four
came directly out of the structural guards, which measure complexity, file size
and dead exports and which this change would otherwise have made worse:

| Extracted | From | Why |
|---|---|---|
| `text_structured_dispatch.ts` | `text_generation_service.svelte.ts` | Identity, shared clock, admission and dispatch are one decision; splitting them made the gate's position inside the coalescer invisible. |
| `text_stream_span.ts` | same | A stream's dispatch and its span are the same facts seen from two sides. |
| `npc_opener_freshness.ts` | `npc_memory_service.svelte.ts` | Four distinct refusal reasons, all pure, none of them one boolean. |
| `npc_background_context.ts` | same | The pre-dispatch, post-completion and at-consumption checks must not drift apart; they all read the same inputs. |
| `npc_consequence_order.ts` | `npc_dialogue_service.svelte.ts` | 2 900 lines of turn orchestration had no use for a pure comparator beyond calling it once. |
| `text_route_revision.ts`, `text_attempt_projection.ts` | — | New capability, genuinely additive. |
| `ai_gameplay_path_probe.ts`, `ai_reasoning_control_probe.ts` | — | The two measurements the review found missing. |

The guard outcomes are in the table above rather than here because the reason a
module exists is not the reason it was worth moving. What is worth stating: the
cognitive-complexity and source-file-size baselines each **shrank** (two records
locked in as reductions), and no baseline was raised.

The regression coverage is concentrated where the defects were seams — six new
test files plus additions to three existing ones — because a test that mirrors
the file it tests adds a filename and no confidence.
