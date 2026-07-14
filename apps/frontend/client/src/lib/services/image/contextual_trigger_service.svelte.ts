// apps/frontend/client/src/lib/services/image/contextual_trigger_service.svelte.ts
//
// Detects game events (location change, combat start, NPC introduction, dramatic
// moment, quest completion) and generates auto-image prompts. Includes debouncing
// per trigger type to prevent floods. Builds prompts from the active style profile
// and calls imageGenerationService to generate.
//
// Contract: C-242 Image Generation Pipeline
// biome-ignore-all lint/style/useNamingConvention: record keys are ContextualTriggerEvent union literals (snake_case)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ContextualTriggerEvent, ImageType } from '@aikami/types';
import { compileImagePrompt } from './prompt_compiler';
import { styleProfileService } from './style_profile_service.svelte';

// ── Trigger config (debounce windows) ──────────────────────────────────

const triggerDebounceMs: Record<ContextualTriggerEvent, number> = {
  location_changed: 30000, // max 1 background per 30s
  combat_started: 30000, // max 1 battle scene per 30s
  npc_introduced: 0, // per-NPC dedup handled separately
  dramatic_moment: 60000, // max 1 illustration per 60s
  quest_completed: 0, // no debounce — one per quest
};

const triggerImageType: Record<ContextualTriggerEvent, ImageType> = {
  location_changed: 'background',
  combat_started: 'background',
  npc_introduced: 'portrait',
  dramatic_moment: 'illustration',
  quest_completed: 'illustration',
};

// ── Interface ──────────────────────────────────────────────────────────

export type ContextualTriggerServiceInterface = BaseFrontendClassInterface & {
  /** Whether contextual auto-generation is enabled. */
  enabled: boolean;
  /**
   * Fires a contextual trigger event, generating a prompt and optionally
   * auto-generating an image via the image generation service.
   * @param options.event - The trigger event type.
   * @param options.context - Descriptive context text (e.g. location name, NPC name).
   * @param options.characterName - Optional character name for NPC portraits.
   * @returns The compiled prompt { positive, negative } or undefined if debounced.
   */
  fireTrigger(options: {
    event: ContextualTriggerEvent;
    context: string;
    characterName?: string;
  }): Promise<{ positive: string; negative: string } | undefined>;
};

export type ContextualTriggerServiceOptions = BaseFrontendClassOptions & {};

// ── Implementation ──────────────────────────────────────────────────────

export class ContextualTriggerService
  extends BaseFrontendClass<ContextualTriggerServiceOptions>
  implements ContextualTriggerServiceInterface
{
  /** Whether contextual auto-generation is enabled. */
  enabled = $state(true);

  /** Tracks last-fire timestamps per trigger event type. */
  private _lastFire: Map<ContextualTriggerEvent, number> = new Map();

  /** Tracks which NPCs have already had portraits generated this session. */
  private _npcPortraitCache: Set<string> = new Set();

  async fireTrigger(options: {
    event: ContextualTriggerEvent;
    context: string;
    characterName?: string;
  }): Promise<{ positive: string; negative: string } | undefined> {
    const { event, context, characterName } = options;

    if (!this.enabled) {
      this.debug('fireTrigger: disabled, skipping', { event });
      return undefined;
    }

    // Debounce check
    const debounceMs = triggerDebounceMs[event];
    if (debounceMs > 0) {
      const lastFired = this._lastFire.get(event) ?? 0;
      if (Date.now() - lastFired < debounceMs) {
        this.debug('fireTrigger: debounced', {
          event,
          remaining: debounceMs - (Date.now() - lastFired),
        });
        return undefined;
      }
    }

    // NPC dedup: one portrait per NPC per session
    if (event === 'npc_introduced' && characterName) {
      const key = characterName.toLowerCase().trim();
      if (this._npcPortraitCache.has(key)) {
        this.debug('fireTrigger: NPC portrait already generated', { characterName });
        return undefined;
      }
      this._npcPortraitCache.add(key);
    }

    // Build prompt
    const profile = styleProfileService.activeProfile;
    if (!profile) {
      this.warn('fireTrigger: no active profile');
      return undefined;
    }

    const imageType = triggerImageType[event];
    const compiled = compileImagePrompt({ basePrompt: context, profile, imageType });

    this._lastFire.set(event, Date.now());

    this.debug('fireTrigger', {
      event,
      context,
      characterName,
      compiled: {
        positive: compiled.positive.slice(0, 60),
        negative: compiled.negative.slice(0, 60),
      },
    });

    return compiled;
  }
}

export const contextualTriggerService: ContextualTriggerServiceInterface =
  ContextualTriggerService.create({
    className: 'ContextualTriggerService',
  });
