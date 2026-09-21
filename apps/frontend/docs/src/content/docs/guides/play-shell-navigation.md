---
title: Play Shell — HUD & Management Navigation
description: The in-game HUD, picking between fullscreen play mode and the management UI, and how Escape focuses.
---

While playing on `/game`, the screen is dominated by the scene: a compact objective, a single **Menu** entry and optional status elements (the clock can be hidden as a preference) each keep a stable slot. Management surfaces — Inventory, Quests, Journal/Notes, Character Sheet, Party, Reputation, World Map — all live inside **one** host: only one is on screen at a time, switching to a section keeps your place in it, and **Back** returns you to whatever you were doing before it opened (or to the Menu when the section was reached from there).

Keyboard mirrors the mouse: press the section shortcut or open **Menu**, move between sections with Tab/Shift+Tab inside the host, and press **Escape** to unwind one level at a time. Held keys do not leak into gameplay when a panel closes, text you were drafting is preserved, and the game pauses exactly while a management surface requires it. In combat the same host stays available, but the legal-action workflow is never duplicated: when the viewport is narrow, the combat sidebar becomes a bottom action sheet instead of splitting the screen.

Source: `apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte`.
