// apps/frontend/client/src/lib/services/game/interaction_prompt_state.svelte.ts
//
// C-327 AC-2 — the interaction prompt's state, as ONE derived value.
//
// The prompt used to be a cached boolean with two writers: the engine published
// a target, and the overlay router separately restored the flag when an overlay
// closed. That second writer had no way to be corrected. `INTERACTION_TARGET_CHANGED`
// is dirty-checked in the engine, so after it publishes a selection it stays
// silent for as long as that selection stands — a restored flag the engine never
// re-published therefore survived until the only two forced clears in the system:
// a map transition or a page reload. Hence "the prompt never goes away".
//
// This module keeps a single input (the engine's current target) and derives
// everything else. Overlays withdraw the prompt because focus is part of the
// derivation, not because somebody remembered to hide it — and closing an
// overlay can hand back a prompt for a target that is genuinely still there, and
// nothing else.

import type { InteractionPromptTarget } from './game_overlay_types.ts';
import { inputActionService } from './input_action_service.svelte.ts';

export type InteractionPromptStateOptions = {
  /** Whether the world — rather than an overlay — currently owns the surface. */
  readonly isWorldFocused: () => boolean;
};

export type InteractionPromptState = {
  /** The engine's current target, or undefined when nothing is in range. */
  readonly target: InteractionPromptTarget | undefined;
  /** Key label resolved at read time, so a rebind or device change repaints. */
  readonly label: string;
  /** A prompt exists only while there is a target AND the world is in focus. */
  readonly visible: boolean;
  /** Target-relative CSS-pixel position, or undefined when not target-anchored. */
  readonly screenX: number | undefined;
  readonly screenY: number | undefined;
  setTarget(options: {
    target: InteractionPromptTarget;
    targetScreenX?: number;
    targetScreenY?: number;
  }): void;
  clear(): void;
  setPosition(options: { targetScreenX?: number; targetScreenY?: number }): void;
};

export const createInteractionPromptState = (
  options: InteractionPromptStateOptions,
): InteractionPromptState => {
  let target = $state<InteractionPromptTarget | undefined>(undefined);
  let screenX = $state<number | undefined>(undefined);
  let screenY = $state<number | undefined>(undefined);

  return {
    get target(): InteractionPromptTarget | undefined {
      return target;
    },
    get label(): string {
      if (target === undefined) {
        return '';
      }
      const keyLabel = inputActionService.actionDisplayLabel('interact');
      return `${keyLabel} — ${target.verb} ${target.targetName}`;
    },
    get visible(): boolean {
      return target !== undefined && options.isWorldFocused();
    },
    get screenX(): number | undefined {
      return screenX;
    },
    get screenY(): number | undefined {
      return screenY;
    },
    setTarget(next): void {
      target = next.target;
      screenX = next.targetScreenX;
      screenY = next.targetScreenY;
    },
    clear(): void {
      target = undefined;
      screenX = undefined;
      screenY = undefined;
    },
    setPosition(next): void {
      screenX = next.targetScreenX;
      screenY = next.targetScreenY;
    },
  };
};
