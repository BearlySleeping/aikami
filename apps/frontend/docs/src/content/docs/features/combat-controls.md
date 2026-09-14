---
title: Combat Controls
description: Move, choose an ability, pick a target and read the engine's forecast in a direct-control encounter. (C-516)
---

Combat in Emberwatch is a tactical, direct-control encounter on a grid: you
spend your own movement and your own actions, and the engine resolves every
roll. Enemies and companions take their turns under the same deterministic
rules, so the same encounter seed always plays out the same way.

## Your turn

- **Move** — press *Move* to highlight every cell you can reach this turn, then
  click one. The cost comes out of your movement budget (the `Move` readout in
  the turn header). Clicking anywhere else does nothing, so a misclick never
  costs you a turn.
- **Ability** — pick an ability from the hotbar. Only abilities you actually
  have are listed, and the panel shows the engine's own forecast: the chance to
  hit and the damage range, never a guaranteed number.
- **Target** — the target list contains only the combatants that are legally in
  range and in line of sight. Confirm to commit the action.
- **Defend** — always available, needs no target, and spends your action.
- **Flee** — leaves the fight entirely and returns you to exploring.
- **End Turn** — hands the turn to the next combatant in initiative order.

Every action is also reachable by keyboard, and the sidebar logs what actually
resolved ("hits for 4", "misses") rather than what you asked for.

## Natural language (v2 encounters)

On a `v2` encounter you can also just say what you want. Type an instruction —
"move to the nearest enemy and use my melee attack", "retreat somewhere safe",
"defend" — and press *Decide*. Combat reads it as an **intent**, not as a
mechanic: you will always see a compiled preview first (the destination, the
movement cost, the resolved target and the engine's hit/damage forecast), and
nothing happens until you press *Confirm*. *Cancel* commits nothing, and you can
keep using the direct controls at any time.

- **Ambiguity asks.** If two readings are equally valid — three goblins at the
  same distance — combat asks once with concrete options and previews the one
  you pick. A single sensible reading previews straight away.
- **Combat stays playable offline.** When the model is unavailable, slow or
  replies with something unusable, ordinary move / attack / ability / defend
  instructions are parsed by a deterministic parser instead. Only the wording
  changes; the rules never do.
- **Your words are data.** Player text is never treated as instructions to the
  model, cannot name a combatant you cannot legally target, and cannot change a
  cost, a roll or a hit point.
- **Kill switch.** `PUBLIC_COMBAT_LANGUAGE_INPUT=0` hides the language input
  entirely; the direct controls and the resolver are unaffected.

## Choosing the engine

Encounter resolution runs on one of two engines, selected once per encounter
through `PUBLIC_COMBAT_ENGINE`:

| Value | Behaviour |
|---|---|
| unset / `legacy` | The shipped turn manager. Default. |
| `v2` | The deterministic Combat 2.0 kernel with the direct controls above. |

Unset and invalid values always resolve to `legacy`, and the choice is pinned
at encounter start. If a v2 start is rejected, `startEncounterWithFallback`
retries that encounter using legacy, and `COMBAT_STARTED.engine` reports the
engine that actually started. V2-only controls may therefore be unavailable for
that encounter; later encounters can still use the configured value.

## Reading enemy intentions (C-526)

An enemy turn shows a short, authored **telegraph** — "Goblin Archer —
preparing an attack on Mara" — so you can see what it is about to attempt
without the game ever exposing hidden state or the model's private reasoning.
The line is bounded and presentation-only: it never changes a rule, a roll or a
cost.

When the AI layer is not available the fight continues exactly as before on the
deterministic planner. The sidebar reports *why* it degraded — the kill switch
is off, or the model was offline, too slow, returned something unusable, or
answered for a stale moment of the fight — once per actor and reason, so the log
is not spammed.

## Narration provenance (C-526)

Resolved turns are narrated in the sidebar. With `PUBLIC_COMBAT_LLM_AGENTS=1`
and a reachable model, that narration is short characterful prose; otherwise it
is the authored template text. Either way it is derived **only** from the
events the engine already resolved — narration never adds a mechanic, a number,
a condition or an outcome that did not happen, and it never delays your next
turn.

Both the AI decisions and the narration sit behind one kill switch,
`PUBLIC_COMBAT_LLM_AGENTS` (default **off**), read once at encounter start and
pinned for that encounter. Off means the deterministic planner and the authored
templates are the only paths; an AI-offline encounter is always completable.
