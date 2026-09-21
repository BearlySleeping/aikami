---
title: Companions
description: Recruit a companion who reacts — recalling what they witnessed, reacting to crossed boundaries, and acting unprompted. (C-494)
---

Some NPCs in the demo adventure can be recruited as **companions**. Unlike a
static quest-giver, a companion behaves like a character: they recall the
consequential events they actually witnessed, react to their authored
boundaries with real state changes, and sometimes act without being asked.

## Recruiting a companion

A companion carries the `isCompanion` flag in the content pack, plus their
recruit and dismiss dialogue keys, class, initial approval, and a banter pool.
To recruit one, talk to them and accept the recruit offer — recruitment flows
through the existing party roster, so the companion appears in the Party
Roster with their authored initial approval. Re-recruiting is idempotent, and
an NPC without `isCompanion` can never be recruited.

## What makes a companion react

A companion's behaviour is **authored in the content pack**, not hardcoded:

- **Identity** — desire, fear, revisable beliefs, relationships, and
  boundaries are expressed through the existing authored-identity fields
  (`agenda`, `personality`, `knowledge`, `boundaries`).
- **Witness recall** — the companion references events they actually
  witnessed (a promise made, a threat seen) in their own voice, and never
  mentions events they merely exist alongside.
- **Boundary reactions** — crossing a companion's line is a **state change**,
  not just a line of dialogue. Authored boundaries use a
  `reaction|trigger` convention, e.g. `refuse|Threaten an innocent villager`:
  - `refuse` — the companion objects and approval drops.
  - `object` — they object but keep cooperating.
  - `leave` — they leave the party.

## Persistence

Companion state (roster membership, approval), witnessed events, and
relationships all survive save/reload through the existing serializable
services.

## Source

- Content: `content/packs/emberwatch/manifest.json` (`npcs.village_guard`)
- Recruitment: `party_roster_service.svelte.ts`
- Reactions: `companion_reaction_service.svelte.ts`
- Witness recall: `npc_dialogue_service.svelte.ts` (`_buildCompanionWitnessRecall`)
