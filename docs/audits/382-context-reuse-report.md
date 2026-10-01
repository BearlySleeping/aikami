# Issue #382 — measured context reuse, prompt projection and background request size

**Refs:** #382 (and #381, whose boundary this lane does not cross)
**Branch:** `perf/382-measured-context-reuse`
**Base:** `98df13ddc041e58c1d501363240d727e23935b96` (`origin/main`, #420 merged)
**Lane plan:** [`382-context-reuse-plan.md`](382-context-reuse-plan.md)

---

## Headline

Three changes, each measured on the pinned runtime before it was written:

1. **The `summarization` task now asks for no reasoning.** Measured per call
   site, reasoning off is roughly **half the latency** and turns truncated,
   schema-invalid output into valid output. This is the largest single win in
   the lane.
2. **A stale opener whose inputs have not changed is no longer re-asked of the
   provider.** 2 of 2 refreshes issued in a 40-minute replay were re-asks of a
   question whose answer the client already held.
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

**Scope of every claim below:** one configuration, CPU-only, n=3 per cell
where a cell is a provider measurement. A machine half this size will not
reproduce 8 000 ms. Nothing here is a claim about a cloud provider, a GPU, or
a different model.

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
saving in this lane comes from §3 and §4, which are different mechanisms.

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

5 of 8 facts kept, 3 dropped. In provider prompt tokens that is **−78 tokens
per background call** (§3.3), which is small next to the reasoning result and
is reported as small rather than folded into it.

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

## 3. Background request size (P3, provider) — the largest win

Measured on the production route, per call site, reasoning on vs off, **interleaved
within each run** so that machine drift cannot be mistaken for a treatment
effect. "Reasoning off" is recorded only when the response actually carries zero
reasoning characters — a `200` is not a honoured field, and it is not treated as
one.

### 3.1 Two independent runs, and why only the ratio is quoted

| task | metric | run 1 (n=3) | run 2 (n=5) |
|---|---|---|---|
| opener refresh | median ms, reasoning ON | 14 233 | **7 565** |
| opener refresh | median ms, reasoning OFF | 7 991 | **4 232** |
| NPC digest | median ms, reasoning ON | 15 098 | **7 973** |
| NPC digest | median ms, reasoning OFF | 9 296 | **4 927** |
| session summary | median ms, reasoning ON | 15 434 | **8 286** |
| session summary | median ms, reasoning OFF | 8 576 | **3 616** |

**Run 2 is ~1.9× faster in EVERY cell — including the control.** The
`session-summary` prompt did not change at all between the runs (119 prompt
tokens in both), and it still got 1.9× faster. That is machine state — thermal
headroom, page cache, model residency — not anything this lane did.

**So the absolute milliseconds are not comparable across runs, and no
before/after latency claim is made from them.** What *is* comparable is the
within-run ratio, because the two arms are interleaved and share the machine
state:

| task | reasoning OFF as a fraction of ON (run 1) | (run 2) |
|---|---|---|
| opener refresh | **0.56** | **0.56** |
| NPC digest | **0.62** | **0.62** |
| session summary | 0.56 | 0.44 |

The ratio reproduces across two independent runs to within 0.01 on two of the
three tasks. That is the finding: **turning the reasoning channel off roughly
halves the wall-clock of all three bounded background tasks.**

### 3.2 The stronger result is not latency at all — it is valid output

| task | reasoning ON | reasoning OFF |
|---|---|---|
| opener refresh | **0/3 valid**, 0/5 valid · 400 completion tokens (**the cap**) | **3/3 valid**, **5/5 valid** · 208 / 227 tokens |
| NPC digest | **0/3 valid**, 0/5 valid · 400 completion tokens (**the cap**) | **3/3 valid**, **5/5 valid** · 258 / 252 tokens |
| session summary | 1/3 valid, 2/5 valid · 400 completion tokens (**the cap**) | **3/3 valid**, **5/5 valid** · 255 / 159 tokens |

With reasoning on, **every cell saturates the 400-token cap** and the output is
cut mid-object — the model spends its entire budget reasoning and returns
truncated JSON. With reasoning off, **every cell is schema-valid at both n**, in
roughly half the tokens.

This is not a latency optimisation with a quality trade-off. It is a
**correctness** result: with reasoning on, these three tasks were mostly
producing output the client had to discard, and the memory service's
`failed`/`invalid-output` path was absorbing it.

### 3.3 What the projection itself saved, in tokens

Unlike §3.1, prompt-token counts are directly comparable across the runs because
they are a property of the request, not of the machine:

| prompt | before | after | saved |
|---|---|---|---|
| opener refresh (user) | 845 | 767 | **−78 tok (−9.2%)** |
| NPC digest (user) | 984 | 906 | **−78 tok (−7.9%)** |
| session summary | 119 | 119 | **0 — control** |

The `session-summary` row is a deliberate control: that task does not read
`buildGameStateFacts`, so the projection does not touch it, and it does not.
The −78 tokens are exactly the 303 characters the projection removes (303/4 ≈
76), which is the arithmetic the change predicts.

### 3.4 Why the whole `summarization` role, and why that is safe here

The brief forbids changing a shared preset globally for unrelated callers. The
measurement resolves that: `summarization` has **exactly three callers** — the
opener refresh, the NPC digest, and the session summary — and **all three are
bounded mechanical JSON extraction**, all three measured above, none creative.
There is no unrelated caller to protect.

What is deliberately **not** touched: `dialogue`, `narration`, `combat-*`,
`persona-create` and every `agent-*` task. The `agent-*` tasks are background
and are intentionally left on the provider default — "background" is a
scheduling class, not a statement that reasoning is waste, and widening to them
would be an inference rather than a measurement.

The preset test was updated to pin the opt-out list to `['envelope',
'summarization']` with the measurements in the comment, so a third entry cannot
be added by hunch.

**Honest limit:** this is a local, CPU-only, single-model measurement. On a
provider that does not declare a reasoning control the adapter emits nothing and
the preference is ignored — which is the designed behaviour, not a silent
failure.

---

## 4. Suppression of unchanged opener refreshes (P2, no provider)

The opener was regenerated on a timer (15 min) and on a new conversation, with
the world-state fingerprint used only to **reject** a result — never to avoid
**asking** for one.

A 40-minute replay (map loads every 30 s, one conversation, repeated proximity):

| | |
|---|---|
| Samples considered | 86 |
| Background calls issued | 2 |
| …whose inputs were **byte-identical** to the call that produced the held opener | **2 (100%)** |
| …whose inputs had genuinely changed | 0 |

The opener now carries the fingerprint it was generated **against**, and a
refresh whose fingerprint still matches re-dates the existing opener instead of
re-asking. This is **not** a result cache: nothing a model produced is replayed.
The existing greeting is still the right answer for the world it was written
for.

**Three properties that make it safe, each with a regression:**

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

The one task with a **100%** repeat-hit rate is the opener refresh — and that
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
server-managed batching is the better trade, and §3's measured result
(three background tasks each roughly halved by asking for less) is the same
lesson at a smaller scale.

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

Every regression below was confirmed to **fail on the original behaviour** by
reverting the production file and re-running, not by inspection.

| area | cases |
|---|---|
| Prompt projection | each excluded fact family dropped; required facts kept; relationship kept; order preserved; an unseen dialogue-only value still dropped; an unseen unknown fact kept; the live `buildGameStateFacts` output projects smaller |
| Bounded rendering | empty → `(unknown)`; truncation observable in text; required facts protected; nothing truncated when it fits |
| Compiled cache | compile-once; distinct key is a miss; **a hash collision cannot serve the wrong block**; LRU by entry count; eviction by size; oversized entry still returned; `clear()`; stats carry no prompt text |
| Keys | persona/name/namespaces/ambiguous-boundary all distinct |
| Memory service | background call builds **no** full projection; background prompt free of dialogue-only facts; an equipment change is not a world change; unchanged inputs are not re-asked; changed world still refreshes; fingerprint-less save refreshes; **suppression does not weaken in-flight revalidation**; opener stamped with its fingerprint |
| Narrative prompt | stable blocks precede per-turn blocks; every section retained; stable prefix byte-identical across differing turns; empty action set renders; optional sections appear only when populated |
| Task preset | the opt-out list is pinned to the two measured tasks, with the numbers in the comment |

**Executed** (each confirmed to run, not to no-op):

| command | result |
|---|---|
| `bun moon run client:test --force` | **4 505 pass, 0 fail** (338 files) |
| `bun moon run client:typecheck --force` | **0 errors, 0 warnings** |
| `bun moon run constants:test --force` | **242 pass, 0 fail** |
| `bun moon run schemas:test --force` | **913 pass, 0 fail** |
| `bun run scripts/src/lib/ops/run_guards.ts` | **10/10 passed** |

---

## 10. Acceptance matrix for #382

| criterion | status |
|---|---|
| Reproducible before/after report with task latency, calls, tokens, cache behaviour, estimated/actual cost and quality | **Measured** — §3 gives before/after latency, completion tokens, prompt tokens and valid-output rate per call site; §7 states why no dollar figure is claimable |
| Explicit routing, disabled roles, privacy/cost settings honored on local, gateway, retry, batch and fallback paths | **Passed** — no routing, role, privacy or fallback path edited. `summarization` keeps `role: 'summarization'`; a provider that declares no reasoning control is sent nothing |
| Deterministic engine authority preserved | **Passed** — no engine path touched; command legality, confirmation and precondition evaluation are unchanged and still run on every extracted command |
| Player control and perception limits preserved | **Passed** — perception still comes from the witness service; §4's suppression reuses a greeting only for the world it was generated against |
| No speculative parallel/provider race | **Passed** — no new concurrency. §6 rejects batching |
| Caching/dedup only where measured | **Passed** — one cache shipped (§2), one proposal retired on measurement (§5) |
| Summarization only where savings beat extra calls and quality loss | **Passed** — §3 ships the preset; no new summarization LLM call was added, and the projection makes each existing one smaller |
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

- **One configuration.** Ollama 0.34.3, `ornith-1.5:9b`, CPU-only. Provider
  cells are n=3 and n=5 in two independent runs. No GPU, no cloud provider, no
  second model.
- **Absolute latencies are not comparable across runs.** The second run was
  ~1.9× faster in every cell *including the unchanged control*, so only
  within-run ratios and token counts are quoted (§3.1). Anyone reproducing this
  should expect the same drift and must not compare their absolute numbers to
  the table in §3.1.
- **No dollar figure.** Local inference is not billed; that is not a saving.
- **Provider cached tokens are UNKNOWN** except on this runtime, and are never
  converted to money.
- **No GPU preemption is claimed.** Aborting an HTTP request does not interrupt
  a kernel. Nothing in §3 depends on cancellation; the win is asking for less.
- **A passing mock proves a contract, not provider behaviour.** The §3 numbers
  come from the real provider on the real route; the unit tests around them
  prove the wiring, not the latency.
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
