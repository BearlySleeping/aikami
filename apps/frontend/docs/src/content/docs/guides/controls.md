---
title: Controls & Movement
description: Keyboard and mouse controls for the Aikami game client.
---

The Aikami game client supports both keyboard and mouse input for movement and interaction.

## Keyboard Controls

| Key | Action |
|-----|--------|
| W / Arrow Up | Move up |
| A / Arrow Left | Move left |
| S / Arrow Down | Move down |
| D / Arrow Right | Move right |
| E / Enter | Interact with NPC or object |

Movement keys can be rebound in Settings → Controls. Arrow keys are fixed and cannot be rebound.

## Mouse Controls

### Click-to-Move (C-380)

Left-click on any walkable tile to pathfind the player there. The player will automatically navigate around obstacles using A* pathfinding.

- **Walkable ground**: Click to walk to the clicked tile.
- **NPCs**: Click an NPC to walk within interaction range and open dialogue.
- **Doors/portals**: Click a doorway to walk to it and trigger a map transition.
- **Blocked tiles**: Clicking a wall or blocked tile will not produce movement.

### Cursor Feedback

- **Hover highlight**: A semi-transparent white square appears under the cursor showing which tile will be targeted.
- **Destination marker**: A green crosshair appears at the clicked destination.

### Cancellation

- **Keyboard interrupt**: Pressing any movement key (WASD or arrows) immediately cancels the current click-path and returns control to keyboard movement.
- **Mode change**: Entering dialogue, combat, or menu mode cancels any active path.
