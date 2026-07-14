---
title: CYOA Choices
description: Guided branching-narrative choices proposed by the CYOA agent after each GM response.
---

The **CYOA (Choose Your Own Adventure) agent** gives you a guided interaction path — after each Game Master response, it proposes 2–4 structured player choices rendered as buttons below the message. Click a choice and it posts as your message, advancing the story. Great for mobile play or whenever you'd rather pick than type.

## How It Works

The CYOA agent runs in the **post-processing phase** of the agent pipeline. It reads the GM's latest narrative and extracts distinct action choices, optionally tagged with D&D-style skill-check hints (e.g. `Persuasion DC 15` badges — informational only, no dice integration yet). Zero choices means the scene has no meaningful branch; a single choice renders as **Continue**.

Your selections are tracked per chat in a **choice history** (last 10) and injected into the GM's context under a *Recent Choices* section, so the GM can reference your past decisions.

## Controls

- **Toggle the agent** per chat from the agent activity menu — enabled by default for new chats.
- **Use CYOA as direction** — when impersonation mode is active, this toggle feeds your clicked choice to the impersonation drafter instead of posting it directly, producing a full in-character message you can keep, edit, or discard.
- Choices are dismissed automatically when you edit or regenerate the AI message they were derived from.

Try it in the dev sandbox at `/dev/cyoa`. Source: `apps/frontend/client/src/lib/services/agent/agents/cyoa_agent.ts` and `apps/frontend/client/src/lib/views/chat/choice_buttons_view.svelte`.
