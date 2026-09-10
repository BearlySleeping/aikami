---
title: Creating your hero
description: Pick an illustrated starter hero and be ready to play in seconds — no long form required. Full customization is one click away.
sidebar:
  order: 3
---

# Creating your hero

When you start a new campaign, Aikami puts the fastest path first: a row of
**illustrated starter heroes** — Thaldrin the fighter, Lyra the wizard, and
Zeph the rogue. Each card shows a real character portrait built from the
hero's appearance, so picking one means "this character is ready," not "please
fill out this form."

## The fast path: pick a preset and play

1. Choose a starter hero card.
2. Give your hero a name (it's pre-filled with the preset's name — you can
   keep it and skip straight through).
3. Optionally pick one thing that drives them. This choice feeds your
   hero's background, which the story systems can pick up on.
4. Click **Enter World**.

That's it — you're playing, no character sheet required. Renaming a preset
doesn't change how the hero looks: the appearance travels with the character.

## Full customization is one click away

If you'd rather build every detail yourself, the creation screen offers two
explicit paths:

- **Customize Everything** — from the fast-path step, this opens the full
  editable character sheet where you can change every stat and detail before
  entering the world.
- **Create Manually** — a step-by-step wizard (identity, play style,
  appearance, review).
- **Chat with the DM** — describe your hero in conversation and let the DM
  turn it into a persona.

The AI chat is always available, but it's the slower path — the starter
heroes are designed to get you into the world faster.

## Source

The onboarding flow lives in
`apps/frontend/client/src/lib/views/onboarding/`, with starter hero data in
`packages/shared/constants/src/lib/characters.ts`.
