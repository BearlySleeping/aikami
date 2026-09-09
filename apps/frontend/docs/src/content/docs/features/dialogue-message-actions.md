---
title: Dialogue Message Actions
description: Which message actions are offered in campaign dialogue vs chat — and why transcript rewinding is gated out of campaign play.
---

In the **campaign dialogue overlay** (`/game`), the message actions offered on a bubble are intentionally limited so you can't silently rewind the world. The world state (inventory, quests, relationships, world flags, RNG) is *not* rewound when you edit the conversation — so the controls that imply it are hidden.

## What's offered in campaign play

Hover a message bubble in a campaign conversation:

| Message | Actions |
|---------|---------|
| **NPC reply** | Copy, **Rephrase**, Speak |
| **Your message** | Copy |

- **Copy** — copy the text to the clipboard.
- **Rephrase** — regenerate the NPC's reply with different wording. This is *presentation only*: it never re-applies a state change (no skill-check delta, quest acceptance, trade, or command). The previous wording is kept so you can swipe back to it.
- **Speak** — play text-to-speech (when available).

The transcript-rewinding controls — **Edit**, **Delete**, and **Branch** — are **not** offered in campaign play. They would let you un-commit a world change (e.g. keep a Ward Wand you obtained in another branch while the transcript claims you never asked for it).

## Where they still appear

The same controls remain available **outside** campaign play, where consequences don't apply:

- The **dev sandbox** (`/dev/sandbox/dialogue`).
- Non-campaign **chat modes** (the rich chat action bar).

The gate is by *mode*, not by component: the underlying capability stays, only the campaign surface drops the rewinding members.

## CYOA branching is unaffected

Guided **Choose Your Own Adventure** branching (the CYOA agent's choice buttons) is a separate feature and keeps working in campaign play. Only the transcript-rewinding actions are gated.

Source: `apps/frontend/client/src/lib/components/chat/message_actions.ts`, `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`.
