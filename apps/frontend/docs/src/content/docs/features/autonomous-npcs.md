---
title: Autonomous NPC Behavior
description: Schedule-based autonomous NPC messaging that makes the world feel alive when you're idle.
---

Aikami's NPCs can send unprompted messages based on their personality, weekly
availability schedules, and your idle state. When you step away from the
keyboard for a few minutes, an available NPC may reach out with a contextual
message — making the world feel alive even when you're not actively playing.

## How It Works

Each NPC has a **7-day × 24-hour availability schedule** that determines when
they're `online`, `idle`, `dnd`, or `offline`. The Schedule Planner agent can
auto-generate realistic schedules from an NPC's personality card, or you can
manually paint the schedule grid with drag-to-fill.

When the player is idle (no mouse/keyboard input for 5 minutes by default) and
not in combat or a dialogue, the autonomous message poller checks all available
NPCs, picks one based on talkativeness weighting, and generates a short
contextual message.

## Settings

Configure autonomous behavior under **Settings → Game → Autonomous NPCs**:

- **Global Pause**: Disable all autonomous messages
- **Idle Threshold**: How long before the system considers you idle (1–30 min)
- **Poller Interval**: How often the system checks for eligible NPCs (30s–5m)
- **Default Cooldown**: Minimum time between autonomous messages per NPC

## Schedule Editor

Open an NPC's schedule to paint their weekly availability grid. Use the
**Generate Schedule** button to let the AI create a realistic routine from the
NPC's personality.

Source: `apps/frontend/client/src/lib/views/settings/autonomous/`
