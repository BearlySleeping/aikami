# Where #382's next slice should go — measurement-first triage

**Status:** proposal. No code changed. Derived from the #412 baseline run plus a
call-graph audit of the real production AI surface.
**Date:** 2026-09-29

> **Superseded for the contention question.** The `MAP_LOADED` prefetch A/B this
> document proposes was run, after the #415 envelope fix, as a burst-WIDTH SWEEP
> rather than a paired A/B. See
> [`382-contention-remeasure-report.md`](382-contention-remeasure-report.md).
> The call-graph findings below still stand; the "proposed next PR" section is
> kept for the reasoning, not as a plan.

---

## The question #412 could not answer

#412 measured one synthetic workload (identical concurrent
`extractStructure`). It could not answer *"where is player-visible latency
actually spent?"* because it never drove a real turn. So before proposing a
next PR, the call graph was walked to find out **how many model calls production
actually makes, and whether they overlap.**

## The real production AI surface

Every text call in production, by task:

| task | site | player-visible? |
|---|---|---|
| `dialogue` | `game_composition_root.svelte.ts:454` | **yes** — streamed prose |
| `envelope` | `game_composition_root.svelte.ts:442` | **yes** — choices + state |
| `combat-intent` | `combat_composition.ts:59` | **yes** — latency-sensitive, 4 000 ms budget |
| `combat-ai` | `combat_composition.ts:85` | **off by default** |
| `combat-narration` | `combat_composition.ts:73` | **off by default** |
| `summarization` | `npc_memory_service.svelte.ts:348` | **background** |
| `summarization` | `npc_memory_service.svelte.ts:391` | **background** |
| `summarization` | `session_summary_service.svelte.ts:198` | **background** |
| `agent-batch`, `agent-custom` | agent modules | unreachable (audit) |

`combat-ai` and `combat-narration` are gated by
`resolveCombatLlmAgents(raw) => raw === '1'` — unset leaves the deterministic
path in place. So with default configuration a turn is:

- **dialogue: 2 calls** (1 streamed + 1 structured)
- **combat: 1 call** (`combat-intent`)

## 🔴 But there IS real background fan-out, and it is unbounded across NPCs

`bridge_listeners.ts:236`, on **every `MAP_LOADED`**:

```ts
bridge.on('MAP_LOADED', () => {
  // …
  npcMemoryService.prefetchForNpcs(gameEngineService.currentMapNpcIds);
});
```

`prefetchForNpcs` (`npc_memory_service.svelte.ts:204`) takes the remembered NPCs
on the map, **sorts and slices to `NPC_MEMORY_MAP_PREFETCH_LIMIT` (4)**, and then
loops:

```ts
for (const record of remembered) {
  void this._prefetchOpener(record.npcId);
}
```

Each `_prefetchOpener` issues a `summarization` `extractStructure`. The guards
that exist are:

- `_prefetching` — dedupes **per NPC**;
- `NPC_MEMORY_PREFETCH_COOLDOWN_MS` — rate-limits **per NPC**;
- `_enqueue(npcId, …)` — serialises **per NPC**.

**There is no cross-NPC concurrency bound.** Four remembered NPCs on a map means
**four concurrent `summarization` calls, launched on map load**, exactly the
fan-out shape that #412's S5 showed costs 3–4× sequential wall-clock on this
hardware.

Two further properties make this the most interesting thing in the table:

1. **It is background work competing with player-visible work.** Nothing
   separates the `summarization` lane from `dialogue`/`envelope`/`combat-intent`.
   A player who walks onto a map and immediately starts a conversation issues 4
   background calls and then a player-visible one against the same provider.
2. **#411's in-flight dedup cannot help.** The four prompts are for four
   *different* NPCs, so they are not identical requests. Coalescing is
   orthogonal to this problem.

## Why this is a measurement proposal, not an implementation

The call-graph evidence says a 4-way background burst **exists**. It does **not**
yet say the burst is harmful, and the difference matters:

- whether the prefetch actually fires (it is staleness-gated, so a fresh
  campaign fires nothing);
- whether a player-visible call ever actually overlaps it;
- what the resulting player-visible latency is versus without it;
- whether the honest fix is bounded concurrency, deferral to idle, or nothing.

#382 says to *"stop speculative optimization when no bottleneck is
demonstrated"*. So the next PR should **measure the real surfaces first**, and
only then, if a bottleneck shows, bound it. The call-graph finding tells us
*where to point the instrument*, which is what a small PR should be for.

## Proposed next PR — scope

**Name:** measure real production AI fan-out and turn-level latency

**What it does (measurement only, no behaviour change):**

1. Extend the test seam to drive a real dialogue turn and a real combat turn —
   the production `game_composition_root` and `combat_composition` paths, not a
   synthetic `extractStructure`.
2. Count provider requests per real turn, and record which lanes overlap.
3. Record turn-level phase breakdown, which #412 explicitly could not do:
   routing → queue → prefill → first token → completion → parse → apply.
4. Compare cold vs warm, and measure a map-load prefetch burst adjacent to a
   dialogue turn — the collision above.
5. **Assert behavioural correctness**, which #412 did not: that a coalesced
   subscriber receives a *parseable* result, and that dialogue/envelope/combat
   outputs still conform to their schemas. Deterministic invariants, not an
   LLM-as-judge score.

**Explicitly not in it:** bounded concurrency, priority queues, deferral, or any
routing change. Those follow only if step 4 demonstrates harm.

**Why this is the smallest useful next step:** #412 proved the harness can
measure the wire reliably and falsify a claim. It also proved the synthetic
workload it measured does not represent production — production fan-out is 2 on
the critical path, and the only real concurrency is a 4-way *background* burst
that nothing bounds. Measuring that is what turns the scheduler question from
speculation into a decision, and it is strictly smaller than any implementation.

## Related deferred items, still deferred

Unchanged by this analysis, with reasons:

| Item | Why still deferred |
|---|---|
| Agent trigger rules (slice 3) | Pipeline is experimental and unwired, by design. |
| Exact-result / provider prompt caching (slice 5) | Needs a separate correctness design per the issue's constraints. |
| Combat prefetch tuning (slice 6) | See the correction below. |

## Correction: combat prefetch does not exist at this baseline

#382 was written against review baseline `2888875f1` and states:

> Combat already has prefetch, caching, squad-aware planning and revision checks.
> Optimize these without creating duplicate state or weakening perception
> boundaries.

Re-checked on current `main`, **the prefetch is not there.** A whole-tree search
for `prefetch` outside assets/content yields only the NPC-memory prefetch
discussed above — no combat decision prefetch. The `combat_ai_service` and
`combat_ai_lifecycle` modules contain no prefetch path.

What *does* still exist is the **revision discipline**: `combat_intent_service`
mints `basedOnRevision` alongside each intent, which is the stale-decision
guard the issue wants preserved. So slice 6 ("combat prefetch tuning, measure hit
rate / stale waste / saved latency") has **nothing to tune**. It is not deferred
for lack of measurement — the mechanism is absent, and `combat-ai` is
additionally flag-gated off by default.

This is a fourth instance of the same pattern as the agent audit: the issue's
source-reviewed findings were accurate at `2888875f1` and have drifted since.
Each should be re-confirmed against current `main` before work is scoped, which
is exactly what #382's own preamble asks for.
