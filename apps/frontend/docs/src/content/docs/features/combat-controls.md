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

## Companion control modes (C-526)

Companions are not damage calculators: each one has a personality, goals and a
judgment of its own, and you decide how much of its turn you want to run. Pick a
mode under the companion's name in the sidebar; the choice is a **player
preference** saved with your party, and it never changes a rule.

| Mode | What happens on the companion's turn |
|---|---|
| **Direct** | The companion's turn is yours. Use the same Move / Ability / Target controls you use for your own turn. |
| **Suggest** | The companion proposes a plan. You see its destination, costs, risks and target, you can re-point the target or re-aim the approach, and nothing happens until you press *Approve*. *Decline* commits nothing and the companion holds position. |
| **Intent** | Same approval flow, plus a standing goal you type in ("hold the bridge", "protect Mara"). The goal is direction for the companion's judgment — it is never a mechanic, and the engine still validates every command. Changing the mode away from Intent clears the goal. |
| **Autonomous** | The companion decides, and you still confirm before anything commits. |

Suggest, Intent and Autonomous are all **player-approved in this release**: there
is no auto-commit path. That is deliberate — the fight waits for you while a
proposal is open, and it does not time out while you think. Switching a companion
to *Direct* retracts an open proposal so you cannot approve a plan for a turn you
have just taken over.

A **Default** of Suggest applies to every companion, including ones recruited
before this feature existed: an older save loads with Suggest rather than
changing behaviour silently.

## Narration provenance (C-526)

Resolved turns are narrated in the sidebar. With `PUBLIC_COMBAT_LLM_AGENTS=1`
and a reachable model, that narration is short characterful prose; otherwise it
is the authored template text. Either way it is derived **only** from the
events the engine already resolved — narration never adds a mechanic, a number,
a condition or an outcome that did not happen, and it never delays your next
turn.

The narrator cannot invent mechanics, by construction rather than by filtering.
It does not write "the goblin dies"; it *references a resolved fact* by kind and
position, and the game renders the sentence from that fact. A reference that does
not resolve is refused and the authored template is shown instead. The optional
free-text flavour sentence beside those facts is admitted only when it is
mechanically inert — no combatant names, no numbers, no outcome words — and only
as ornament on facts that were already verified. Nothing in the game claims that
prose is machine-verified; it claims that the only mechanical text you see was
rendered from an event, and that anything unverifiable falls back to a template.

Narration keeps the log in order even when the model answers late: the authored
template reserves the entry's place the moment the turn resolves, and the model's
wording replaces that entry in place.

A `Deterministic AI — …` line in the log is information, not an error: it means
that actor fell back to the shipped planner for the stated reason.

Both the AI decisions and the narration sit behind one kill switch,
`PUBLIC_COMBAT_LLM_AGENTS` (default **off**), read once at encounter start and
pinned for that encounter. Off means the deterministic planner and the authored
templates are the only paths; an AI-offline encounter is always completable.

## Battlefield objects and improvised actions (C-531)

A v2 encounter can author real objects — a brazier, an oil pool, a breakable
support holding a crate — and each one carries its own durability, cover and
list of things you can actually do to it. Objects are content, not special
cases: a pack declares a prop's durability and affordances, and the encounter
places instances of it. Adding another usable object needs no engine code.

**Inspecting.** Objects you can currently act on are selectable by click or by
keyboard. The inspector lists every action the object exposes and, for the ones
you cannot take right now, the reason — out of reach, already broken, or a
check your character sheet cannot supply a modifier for.

**Preview.** Before anything commits, the preview states the action cost, the
check (category, DC and the modifier it will use), and the consequences the
authored recipe declares: which cells are affected, what breaks, what moves,
what catches fire and what cover changes. A preview that involves a die roll
shows odds, never a certainty, and consuming a preview costs nothing — no
action, no movement, no dice.

**Resolution.** Confirming sends one command to the same kernel that resolves
attacks and movement. The kernel validates eligibility and budgets, rolls on the
combat encounter's `actions` stream, and emits the resulting events. An invalid
command changes nothing at all. A legal attempt that fails still spends the
action you declared — that is the cost of trying.

**Consequences persist.** Objects that break stay broken, payloads that fall
stay where they landed, and fire that spreads keeps burning. Walkability, line
of sight and cover are recomputed from terrain *plus* current object state, so
destroying a support opens the way it was blocking and removes the cover it was
granting — without erasing the map underneath. Fire applies at most one hit per
fighter per round from the same hazard family, and surfaces that declare an
expiry are removed at the round they name.

**Offline.** Every one of these actions works with no network and no model.
Language input is a convenience on top of the same controls, not a requirement:
if interpretation fails you get the direct controls and the authored narration
templates, and nothing is invented to cover the gap.

## Objectives (C-532)

An encounter can be decided by more than attrition. When a fight authors
objectives, a panel appears above the HP bars listing each one that is visible:
its label, its status, any count it is tracking, and — when it declares one —
the round by which it must be met. Objectives the encounter marks hidden are
evaluated exactly the same way but never appear, so a condition can be
discovered rather than read.

The panel is a labelled region with one screen-reader sentence per objective,
and it states status and deadline in words rather than by colour. It answers
from the engine's own state snapshot, so it cannot disagree with the kernel
about whether the ritual was actually stopped.

Some objectives are **required**: the fight does not end in your favour on
attrition alone while one is unmet, and losing a protected ally is a defeat
whatever else you achieved.

## Reactions (C-532)

Leaving an enemy's reach can provoke an opportunity attack. When one is offered,
a decision surface opens showing who is reacting, at whom, with which ability,
at what cost, and what the consequence is. You can take it or decline; pressing
Escape declines.

Player-controlled reactions currently use **Ask**: the decision remains open
until you take or decline it. There is no player-facing reaction-policy control,
reaction timer, or default time limit. **Auto** (take each legal reaction) and
**Never** (decline each reaction) exist as implementation policies but are not
currently available as player settings.

While a reaction window is open nothing else can execute: the movement that
provoked it is paused, and only the reaction resolves before play continues. If
the reaction drops the mover, the rest of that move is cancelled — the cells
already walked are not re-walked and no attack is rolled twice.

## Nonlethal outcomes (C-532)

Enemies can break. Morale is tracked per combatant, and when it falls past the
threshold the encounter's authored responses become legal:

- **Retreat** is real movement toward an authored exit. A fleeing enemy still
  fights on the way out and only stops contesting the field once it reaches the
  exit.
- **Surrender** ends that enemy's hostility outright while preserving its health
  and identity — nobody is recorded as killed who was not.

Neither is a fabricated death. Both feed the same settlement as any other
outcome, so a routed warband or a surrendered guard can decide the encounter in
your favour, and the objective panel and result banner say which reason applied.
