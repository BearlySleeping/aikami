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

## Choosing the engine

Encounter resolution runs on one of two engines, selected once per encounter
through `PUBLIC_COMBAT_ENGINE`:

| Value | Behaviour |
|---|---|
| unset / `legacy` | The shipped turn manager. Default. |
| `v2` | The deterministic Combat 2.0 kernel with the direct controls above. |

Unset and invalid values always resolve to `legacy`, and the choice is pinned
at encounter start — changing the variable mid-fight changes nothing, and the
next encounter picks up the new value.
