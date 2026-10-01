# Issue #382 — measured context reuse, prompt projection and background request size

**Refs:** #382 (and #381, whose boundary this lane does not cross)
**Branch:** `perf/382-measured-context-reuse`
**Base:** `98df13ddc041e58c1d501363240d727e23935b96` (`origin/main`, #420 merged)
**Lane plan:** [`382-context-reuse-plan.md`](382-context-reuse-plan.md)

---

## Headline

Three changes were originally reported below. Review found P3 used the wrong
schemas and a property-presence check; its provider conclusions are withdrawn
pending a successful corrected rerun (§3).

1. **The `summarization` task asks for no reasoning.** The preset is unchanged,
   but the original latency and schema-validity evidence does not establish
   its benefit for the three task-specific output shapes (§3).
2. **A stale opener whose inputs have not changed is no longer re-asked of the
   provider.** 2 of 3 calls issued in the chronological 40-minute replay had
   unchanged inputs; one followed a conversation and had changed inputs.
3. **Background memory prompts stop carrying dialogue-only world facts, and the
   persona stops costing an O(manifest) walk.** The persona alone was
   32–46% of two background system prompts and was re-derived on every call.

Two proposals were **measured and retired**: an application-level exact-result
cache, and application batching. Both are documented below with the numbers
that killed them. Neither shipped.

---

## The measurement environment

| | |
|---|---|
| Runtime | **Ollama 0.34.3** |
| Model | `ornith-1.5:9b` (Qwen3.5 family, Q4_K_M, 6.55 GB) |
| Route | native `/api/chat` — the route the client actually uses |
| Hardware | i9-14900HX, 32 threads, 31.1 GB RAM, **CPU only** |
| Provider spend | **zero** — see §7 on what that does and does not license |

Probe: `apps/frontend/client/scripts/ai_context_reuse_probe.ts`.

```
bun run --cwd apps/frontend/client probe:ai-context-reuse
bun run --cwd apps/frontend/client probe:ai-context-reuse -- --only p3 --reps 5
```

Raw evidence (gitignored, regenerable): `.evidence/382-context-reuse/`.

**Scope:** the environment table describes the original local measurements.
Their P3 conclusions are withdrawn; the corrected sandbox rerun could not
connect (§3). P1 and P2 are deterministic probes, not provider benchmarks.

---

## 1. Production inventory, re-verified against `98df13ddc`

The reviewed snapshot named in the brief (`6325e9bc5`, #417 merged) is three
commits behind `origin/main`. Every row below was read in today's code.

| Surface | State at base | Disposition |
|---|---|---|
| `envelope` extraction | `reasoning: 'none'`; 0/33 → 19/20 completed | **Superseded** (#415). Not revived. |
| In-flight coalescing | route + scope in the key; entry dropped on settle | **Superseded** (#418/B). Used unchanged. |
| Background admission | priority-aware deferral | **Superseded** (#417/C). Used unchanged. |
| Streaming / deadlines | native NDJSON, one absolute deadline, per-attempt accounting | **Superseded** (#420/A). Used unchanged. |
| Combat prefetch | **does not exist**; no call site | **Not revived.** No new evidence. |
| Unwired agent activation | not wired; no trigger | **Not revived.** No new evidence. |
| NPC memory prompt assembly | re-derived per call; `_npcContext` ran a full `buildContext` **twice per background call** for one string | **Carried → fixed.** |
| Background world-state projection | both background tasks received the full dialogue fact list | **Carried → fixed.** |
| Opener refresh | gated on age + `forConversation` only; the world fingerprint existed but only ever REJECTED a result | **Carried → fixed.** |
| Narrative prompt order | stable `[ALLOWED ACTIONS]` placed *after* per-turn state | **Carried → fixed.** |
| Exact-result cache | `TextCacheLayer` had an unused `'exact-result'` member | **Evaluated → retired** (§5). |
| Application batching | no primitive for MAP_LOADED opener work | **Evaluated → retired** (§6). |

**Accepted memory writes vs discarded inference.** The lifecycle's own counters
separate these and were left untouched: `applied` / `invalidated-after-completion`
/ `superseded-before-dispatch` / `overloaded` / `cancelled` / `failed`. The
change in this lane moves work from the `applied`-by-provider-call column into
the `applied`-without-a-call column, and the report distinguishes those.

---

## 2. Prompt composition (P1, no provider)

### 2.1 What the real prompts weigh

| prompt (fixture) | chars | est. tokens |
|---|---|---|
| `digestSystem` | 1 383 | 346 |
| `digestUser` | 1 973 | 493 |
| `openerSystem` | 966 | 242 |
| `openerUser` | 2 190 | 548 |
| `dialogueSystem` | 4 140 | 1 035 |

### 2.2 How much of it is re-derivation

| measurement | value |
|---|---|
| Second opener refresh for the same NPC, same world: share of prompt characters already read | **99.4%** |
| Digest system prompt: share that is pure template + persona | **98.3%** |
| Persona as a share of `digestSystem` | **32%** |
| Persona as a share of `openerSystem` | **46%** |

**What this is and is not.** This is client CPU and allocation, *not* a
provider saving — a provider is only paid for what it is sent, and re-deriving
a string locally costs nothing at the wire. The report states it that way
because conflating the two is how a "cache" gets credited with a saving it did
not produce. The compiled-prompt cache removes the re-derivation; the provider
call saving in this replay comes from §4; provider savings in §3 await a
corrected measurement.

### 2.3 Context a bounded background task was being handed

| carried but unusable | chars |
|---|---|
| `Game difficulty:` — the GM guidance paragraph | **190** |
| `Hint (easy mode only):` | 52 |
| `Equipped:` | 58 |

The GM paragraph instructs a **live** NPC how explicitly to steer the player.
The digest writes a private memory note; the opener refresh writes a greeting.
Neither has a player turn to steer, and a greeting generated under "be very
direct — openly name the item" reads as a non-sequitur in a memory context.

**The projection that replaced it.** Excluded by prefix, and every exclusion is
named in `BACKGROUND_EXCLUDED_FACT_PREFIXES` with its reason. Kept: gold,
inventory, active quests, offerable quests, difficulty, relationship standing —
a digest that lost the quest the player is working toward would write a worse
memory, which is a quality regression and not a saving.

Measured effect on the two background user prompts, same fixtures, same
renderer:

| prompt | before | after | saved |
|---|---|---|---|
| digest (user) | 1 973 chars | 1 670 chars | **−303 (−15.4%)** |
| opener refresh (user) | 2 190 chars | 1 887 chars | **−303 (−13.8%)** |

5 of 8 facts kept, 3 dropped. This deterministic character saving remains
valid; provider token savings require the corrected measurement in §3.

The classification matches on PREFIX, not on a whole string, so a new value of
a known dialogue-only family is still dropped — and a fact nobody has seen is
**kept**, because wrongly guessing it is dialogue-only is the worse error.

**Truncation is deliberate and observable.** A character budget sits on top of
the upstream *count* cap (a count cap does not bound characters). Required
facts are protected and emitted first; anything dropped is named in the
rendered text (`[N further world fact(s) omitted for length]`), so a
truncation can never be a silent prompt change.

### 2.4 Persona without the manifest walk

The background path called `npcDialogueService.buildContext(...)` and kept only
`.persona`. That call walks **every account in every situation of the content
manifest**, selects a companion witness, derives allowed commands and projects
a memory window — O(manifest) work, **twice per background call** (once to
dispatch, once to revalidate), for one string.

`buildNpcPersonaForPrompt` is the persona-only path. It still asserts
configuration, still derives from the authored identity, and still logs the
generic-persona diagnostic. The regression counts the calls rather than timing
them, so it is deterministic.

---

## 3. Background request size (P3, provider) — corrected validation

### 3.1 Original measurements withdrawn

The original n=3 and n=5 runs sent an opener-only schema for **all three**
tasks and accepted any parsed object with an `opener` property. They did not
validate digest `summary`/`notes`, opener suggestions, or session-summary
`synopsis`/`keyEvents`/`npcInteractions`. Their reported “schema-valid” counts
are invalid, and the digest/summary latency and token measurements describe
the wrong constrained output shape. The prior latency ratios and correctness
conclusions are withdrawn; they cannot justify the shared preset.

### 3.2 Corrected probe and rerun (2026-10-01)

P3 selects its request schema from `task.shape`: `NpcMemoryDigestSchema`,
`NpcMemoryOpenerOutputSchema`, or `SessionSummaryOutputSchema`. The summary
schema matches the current session summary service's output contract. Every
parsed completion must pass `Value.Check` against that same TypeBox schema.
Missing fields, incorrect field types, and invalid suggestion chips fail.

Reran the corrected probe with `--only p3 --reps 3`, interleaving reasoning
on/off for each task at `http://127.0.0.1:11434`, model `ornith-1.5:9b`:

| task | reasoning ON | reasoning OFF |
|---|---|---|
| opener refresh | 0/3 HTTP successes; no completions | 0/3 HTTP successes; no completions |
| NPC digest | 0/3 HTTP successes; no completions | 0/3 HTTP successes; no completions |
| session summary | 0/3 HTTP successes; no completions | 0/3 HTTP successes; no completions |

All 18 requests failed to connect: this sandbox has no Ollama listener at the
configured endpoint. The probe wrote
`.evidence/382-context-reuse/context-reuse-p3.json` and exited 0, but that is
**not a successful provider measurement**. Validity rates, latency, token
savings, and whether the provider honors `think: false` remain **unmeasured**
with the corrected schemas. Aggregate zeroes for empty successful samples
must not be read as zero latency or a measured 0% validity rate.

A successful rerun on the pinned runtime is still required before restoring
claims about the reasoning preference. A synthetic native-response check passed 24 responses: task schemas were
selected correctly, valid outputs passed, and missing fields, invalid nested
types, and malformed JSON failed. This verifies probe behavior and cannot
replace the provider measurement.
The existing `summarization` preset is unchanged by this review fix.

---

## 4. Suppression of unchanged opener refreshes (P2, no provider)

The opener was regenerated on a timer (15 min) and on a new conversation, with
the world-state fingerprint used only to **reject** a result — never to avoid
**asking** for one.

A 40-minute replay (map loads every 30 s, one conversation, repeated proximity):

| | |
|---|---|
| Samples considered | 86 |
| Background calls issued | 3 |
| …whose inputs were **byte-identical** to the call that produced the held opener | **2 (66.7%)** |
| …whose inputs had genuinely changed | 1 |

Chronological calls occur at 6:00 (conversation end, changed inputs), 21:30
and 37:00 (unchanged inputs). Samples are sorted by `atMs` before replay.

The opener now carries the fingerprint it was generated **against**, and a
refresh whose fingerprint and `forConversation` still match the current
world and `conversationCount` re-dates the existing opener instead of
re-asking. This is **not** a result cache: nothing a model produced is replayed.
The existing greeting is still the right answer for the world it was written
for.

**Four properties that make it safe, each with a regression:**

- **A different conversation still refreshes.** Matching world facts cannot
  make an opener for an earlier conversation reusable. Re-dating preserves
  the valid opener’s original `forConversation` value.

- **A real world change still refreshes.** The fingerprint is compared, not the
  clock.
- **The in-flight revalidation is NOT weakened.** Two independent guards: this
  one avoids *asking*, the pre-existing one still *rejects* an answer whose
  world moved on mid-call. Losing the second would date a stale opener forward
  into a freshness it has not earned. There is a dedicated regression for that.
- **An old save takes the expensive direction.** `worldFingerprint` is optional
  and additive; an absent fingerprint never matches a computed one, so a save
  written before the field existed **refreshes** rather than trusting a greeting
  it cannot prove is current.

**One deliberate behaviour change, stated plainly:** a returning player may now
see the same greeting they saw 20 minutes ago if nothing about their world
changed. Before, they got a second greeting for the same situation. Given that
the refresh prompt explicitly instructs the model to *never repeat an earlier
greeting*, the previous behaviour was buying novelty at the cost of a provider
call — and the player-visible cost of this change is bounded by the fact that
the same greeting is still the correct one for the unchanged situation.

---

## 5. Exact-result cache — measured, then retired

`TextCacheLayer` already had an unused `'exact-result'` member. That is an
invitation, not evidence, so the bar was set before any code: name the
user-visible semantics and produce a real repeat-hit distribution.

| candidate | repeat-hit verdict |
|---|---|
| `narration` / `dialogue` | Fresh prose every turn by design. **Non-cacheable.** |
| `envelope` | Metadata extracted from a narrative that was just streamed; different input each turn. **Non-cacheable.** |
| NPC digest | One per conversation, each carrying a different transcript. **Non-cacheable** (P2 confirms: `digestRepeatable: false`). |
| opener refresh | The prompt deliberately embeds the **previous** greeting and instructs the model never to repeat it. A byte-identical repeat is not merely rare — it is **not the same request**, and replaying a stored opener would return the greeting the prompt was written to avoid. **Non-cacheable.** |
| `agent-*` | Outside this lane's ownership and outside the measured paths. |

The opener path has **2/3 (66.7%)** unchanged-input calls in this replay — and that
is precisely the task a result cache must **not** serve, for the reason above.
The measurable repeat was real, but the right response to it was to stop
asking (§4), not to store the answer.

**Nothing shipped. The `'exact-result'` telemetry member stays unset.** A cache
with no production user, no hit it may legally serve, and a key that would have
to span task/schema/prompt/compiler versions, full route identity, language,
pack, account, campaign and a state fingerprint, is a framework — and #382
explicitly rejects a generic caching framework with no production users.

---

## 6. Application batching — measured, then retired

`MAP_LOADED` can issue up to four concurrent opener calls. The proposal was one
envelope carrying all four.

**It is rejected on four independent grounds, only the first of which is
numerical:**

1. **It mixes private knowledge.** Four NPCs' memories, notes and secrets in
   one request is a cross-NPC disclosure the current design never permits. Each
   NPC's memory is scoped to it.
2. **It lengthens a nonpreemptible job.** #420 documented that aborting an HTTP
   request does not interrupt provider-side compute. One batched call is a
   *longer* single nonpreemptible job than four shorter ones — it makes the
   residual problem this program is about **worse**, not better. That cost is
   counted, not waved away.
3. **Failure amplification.** One invalid envelope fails all four NPCs' memory
   work; today each degrades independently.
4. **No reachable compatible workload was identified.** The compatibility
   predicate batching needs — same connection, schema semantics, privacy scope,
   language, policy and acceptable latency — does not hold across NPCs.

**Nothing shipped.** The honest statement is that fewer, smaller requests plus
server-managed batching is the better trade, while the reasoning-control benefit
still requires the corrected provider measurement described in §3.

---

## 7. Cache layers, reported separately

| layer | status in this lane |
|---|---|
| **Compiled template / schema cache** | **Shipped.** Client-side, content-keyed, bounded by entry count AND bytes, cleared on every lifecycle retirement. Removes re-derivation (§2.2). Not a provider saving. |
| **Provider prefix / KV cache** | **Improved, not claimed.** Stable blocks now precede per-turn state (§8). Whether a provider caches a prefix, and what it saves, is a property of that provider. On this runtime `prompt_eval_cached_count` exists and is recorded per call; elsewhere it is **UNKNOWN**. |
| **In-flight coalescing** | **Untouched** (#411/#418). Used unchanged. |
| **Application result cache** | **Not built** (§5). `'exact-result'` remains unset. |
| **Prepared opener reuse** | **Shipped** as *suppression* (§4), not storage. |

**No dollar figure appears anywhere in this report.** Ollama bills nothing,
which makes the invoice zero and says nothing about electricity, hardware
amortisation or a paid provider. Cached prompt tokens are not dollars unless the
provider's pricing is known and supported, and it is not known for any provider
not measured here. B's per-attempt accounting is unchanged, so one provider call
is still billed once: a suppressed refresh records no provider attempt at all,
rather than a second attempt for an already-paid answer.

---

## 8. Stable prefix ordering

The narrative system prompt emitted `[ALLOWED ACTIONS]` **last**, after the
`[GAME STATE]` and `[CONVERSATION HISTORY]` it describes. A provider prefix
cache can only reuse a prefix, so the cacheable region stopped at the persona
and the action set re-transmitted on every turn that any world fact changed.

`[ALLOWED ACTIONS]` is derived from content-pack capabilities and is constant
for a conversation, so it now sits with the persona. **Section contents are
unchanged and nothing was removed** — a model still receives every instruction,
now above the state it applies to. The regression asserts the stronger property
directly: the text before the first per-turn section is byte-identical across
two turns that differ only in state.

This is a *latent* improvement whose realised value depends on the provider's
cache. It is reported as such, not as a measured token saving.

---

## 9. Tests

The table below describes the original lane’s regression coverage. The review
fix strengthens the equipment and production-fact assertions and adds a
conversation-mismatch regression; current validation is recorded separately.

| area | cases |
|---|---|
| Prompt projection | each excluded fact family dropped; required facts kept; relationship kept; order preserved; an unseen dialogue-only value still dropped; an unseen unknown fact kept; the live `buildGameStateFacts` output projects smaller |
| Bounded rendering | empty → `(unknown)`; truncation observable in text; required facts protected; nothing truncated when it fits |
| Compiled cache | compile-once; distinct key is a miss; **a hash collision cannot serve the wrong block**; LRU by entry count; eviction by size; oversized entry still returned; `clear()`; stats carry no prompt text |
| Keys | persona/name/namespaces/ambiguous-boundary all distinct |
| Memory service | background call builds **no** full projection; background prompt free of dialogue-only facts; an equipment change is not a world change; unchanged inputs are not re-asked; changed world still refreshes; fingerprint-less save refreshes; **suppression does not weaken in-flight revalidation**; opener stamped with its fingerprint |
| Narrative prompt | stable blocks precede per-turn blocks; every section retained; stable prefix byte-identical across differing turns; empty action set renders; optional sections appear only when populated |
| Task preset | the existing opt-out list is pinned; comments now flag the withdrawn P3 evidence |

**Historical lane checks** (not results of the review-fix rerun):

| command | result |
|---|---|
| `bun moon run client:test --force` | **4 505 pass, 0 fail** (338 files) |
| `bun moon run client:typecheck --force` | **0 errors, 0 warnings** |
| `bun moon run constants:test --force` | **242 pass, 0 fail** |
| `bun moon run schemas:test --force` | **913 pass, 0 fail** |
| `bun run scripts/src/lib/ops/run_guards.ts` | **10/10 passed** |

### Review-fix validation (2026-10-01)

- Client `test:unit` package script (with `AIKAMI_INCLUDE_DEV_ROUTES=true`):
  **4,506 passed, 7 skipped, 2 todo, 0 failed** across 339 files, including
  equipment-only refresh, conversation mismatch, and strict fact reduction.
- `client:typecheck`: **0 errors, 0 warnings**.
- `schemas:test`: **913 passed**; `constants:test`: **242 passed**.
- Client, schema, and constants lint/format plus schema typecheck: **passed**.
- Structural guards: **10/10 passed**; `git diff --check`: **passed**.
- P2: **3 calls, 1 changed-input and 2 unchanged-input**; sorted call times checked.
- P3 synthetic validation: **24 responses checked** (§3.2). Real provider
  performance/quality validation remains **blocked** by the unavailable endpoint.

---

## 10. Acceptance matrix for #382

| criterion | status |
|---|---|
| Reproducible before/after report with task latency, calls, tokens, cache behaviour, estimated/actual cost and quality | **Blocked** — corrected P3 rerun had no successful provider responses; prior task-shape/validity claims withdrawn; §7 states why no dollar figure is claimable |
| Explicit routing, disabled roles, privacy/cost settings honored on local, gateway, retry, batch and fallback paths | **Passed** — no routing, role, privacy or fallback path edited. `summarization` keeps `role: 'summarization'`; a provider that declares no reasoning control is sent nothing |
| Deterministic engine authority preserved | **Passed** — no engine path touched; command legality, confirmation and precondition evaluation are unchanged and still run on every extracted command |
| Player control and perception limits preserved | **Passed** — perception still comes from the witness service; §4's suppression reuses a greeting only for the world it was generated against |
| No speculative parallel/provider race | **Passed** — no new concurrency. §6 rejects batching |
| Caching/dedup only where measured | **Passed** — one cache shipped (§2), one proposal retired on measurement (§5) |
| Summarization only where savings beat extra calls and quality loss | **Pending corrected measurement** — the preset remains, but §3 does not establish its quality or latency benefit; no new LLM call was added |
| Required facts and provenance preserved | **Passed** — required facts are protected from the budget and any omission is named in the prompt text |
| Combat prefetch tuning | **Not applicable** — no combat prefetch exists at this base and no new call-site evidence appeared |
| A/B/C dependencies used unchanged | **Passed** — coalescing identity, admission, lifecycle and transport untouched |

**Distinct statuses above:** *measured* (quantified before and after), *passed*
(verified by a test that fails without the change), *not applicable* (the
surface does not exist at this base), *retired* (§5, §6 — evaluated and
rejected on evidence).

**#382 stays open.** A checked box is not a program. Still outstanding and
**not** addressed here: application-level result caching, a combat prefetch,
hosted-provider prefix-cache measurement, and any multi-agent workload
evaluation.

---

## 11. Limitations and what is NOT claimed

- **One configuration.** Ollama 0.34.3, `ornith-1.5:9b`, CPU-only. Original provider
  cells were n=3 and n=5 with flawed schema selection and validation (§3). No
  GPU, no cloud provider, no second model.
- **Corrected provider results are unavailable.** All 18 rerun requests failed
  to connect; no performance or output-quality comparison can be made (§3).
- **No dollar figure.** Local inference is not billed; that is not a saving.
- **Provider cached tokens are UNKNOWN** except on this runtime, and are never
  converted to money.
- **No GPU preemption is claimed.** Aborting an HTTP request does not interrupt
  a kernel. The corrected P3 rerun establishes no inference savings.
- **A passing mock proves a contract, not provider behaviour.** Schema checks
  prove validation wiring; the real provider rerun remains blocked (§3).
- **The §2.2 repetition is client cost, not provider cost**, and is labelled as
  such wherever it appears.
- **§8's prefix benefit is latent.** Its realised value is a property of the
  provider, and is not measured here.
- **§4 changes a player-visible detail**: a returning player may see the same
  greeting if nothing changed. That is a deliberate trade, stated in §4.
- **P2 is a deterministic replay** of the production staleness rules against a
  scripted session, not an instrumented production session. It answers "would
  a cache fire", not "how often does a real player walk past the same NPC".

## 12. Rollback

Every change is local and independently revertable:

| to undo | revert |
|---|---|
| reasoning control | `reasoning: 'none'` on the `summarization` preset in `text_task.ts` |
| unchanged-refresh suppression | the fingerprint check in `_refreshOpener` |
| background projection | `_npcContext` returning unprojected facts; `worldFingerprint` is additive and ignored by an old save |
| compiled cache | the two `_promptCache.get(...)` wrappers (the cache is a pure memo — removing it changes only CPU) |
| prompt order | `buildNarrativeSystemPrompt` in its own module |

No migration, no persisted-format change that a rollback cannot ignore, no
network destination, no provider, no model download.

## 13. Changed-file count

See the PR body for the final GitHub-reported count. Target band was 60–85 with
a hard cap of 100; the delivered count is **below** that band because every
item is a distinct correctness surface with its own regression and the
instruction is explicit that a correct smaller PR beats artificial churn. The
band was not padded with one-file-per-fixture churn, duplicated tests,
unrelated refactors or renames.
