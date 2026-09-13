// apps/frontend/client/src/lib/services/image/contextual_trigger_service.svelte.ts
//
// Detects game events (location change, combat start, NPC introduction, dramatic
// moment, quest completion) and compiles auto-image prompts from the active
// style profile. NPC introductions additionally generate a portrait and register
// it under `expressionAssetTag({ npcId, emotion })` (C-512) — fire-and-forget,
// so a generation never blocks dialogue, combat or movement.
//
// Contract: C-242 Image Generation Pipeline; C-512 AC-2 / AC-5
// biome-ignore-all lint/style/useNamingConvention: record keys are ContextualTriggerEvent union literals (snake_case)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { ContextualTriggerEvent, ImageType } from '@aikami/types';
import type { GeneratedAssetOutcome, GeneratedAssetSaveOutcome } from '$types';
import { generatedAssetWorkflow } from './generated_asset_workflow.ts';
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

/** The recipe NPC portraits are generated with. */
const NPC_PORTRAIT_RECIPE_ID = 'portrait' as const;

/** Emotion a first-interaction portrait is registered under. */
const NPC_PORTRAIT_EMOTION = 'neutral' as const;

/**
 * `localStorage` key for the contextual-generation opt-in.
 *
 * Default is OFF (C-512 Open Question 2): once a trigger writes bytes,
 * generating from private play without an explicit opt-in would silently spend
 * GPU time and disk on content the player never asked for.
 */
const ENABLED_STORAGE_KEY = 'contextualGenerationEnabled' as const;

/** Reads the persisted opt-in; an unreadable store means "off". */
const _readEnabledPreference = (): boolean => {
  try {
    return localStorage.getItem(ENABLED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

/** Persists the opt-in; storage failures are non-fatal. */
const _writeEnabledPreference = (value: boolean): void => {
  try {
    localStorage.setItem(ENABLED_STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Best-effort: the in-memory flag still governs this session.
  }
};

// ── Interface ──────────────────────────────────────────────────────────

export type ContextualTriggerServiceInterface = BaseFrontendClassInterface & {
  /** Whether contextual auto-generation is enabled. Defaults to off. */
  enabled: boolean;
  /** Turns contextual generation on/off and persists the choice. */
  setEnabled(value: boolean): void;
  /**
   * Fires a contextual trigger event, compiling a prompt and — for an NPC
   * introduction — queueing a portrait generation + registration.
   *
   * Never awaits generation: it resolves with the compiled prompt (or
   * `undefined` when debounced/deduped) while the generation is still running.
   *
   * @param options.event - The trigger event type.
   * @param options.context - Descriptive context text (e.g. location name, NPC name).
   * @param options.characterName - Optional character name for NPC portraits.
   * @param options.npcId - NPC id; required for a resolver-reachable portrait tag.
   * @returns The compiled prompt { positive, negative } or undefined if debounced.
   */
  fireTrigger(options: {
    event: ContextualTriggerEvent;
    context: string;
    characterName?: string;
    npcId?: string;
  }): Promise<{ positive: string; negative: string } | undefined>;
  /** Resolves once every queued contextual generation has settled (tests/teardown). */
  drain(): Promise<void>;
};

export type ContextualTriggerServiceOptions = BaseFrontendClassOptions & {
  /**
   * Generates an asset descriptor (the C-512 byte seam). Defaults to the
   * production workflow; tests inject a fixture.
   */
  generateAsset?: (options: {
    recipeId: string;
    prompt: string;
    negativePrompt?: string;
    npcId?: string;
  }) => Promise<GeneratedAssetOutcome>;
  /** Persists a generated result. Defaults to the production workflow. */
  saveAsset?: (options: { tag: string }) => Promise<GeneratedAssetSaveOutcome>;
};

// ── Implementation ──────────────────────────────────────────────────────

export class ContextualTriggerService
  extends BaseFrontendClass<ContextualTriggerServiceOptions>
  implements ContextualTriggerServiceInterface
{
  /** Whether contextual auto-generation is enabled. Off unless opted in. */
  enabled = $state(_readEnabledPreference());

  private readonly _generateAsset: NonNullable<ContextualTriggerServiceOptions['generateAsset']>;
  private readonly _saveAsset: NonNullable<ContextualTriggerServiceOptions['saveAsset']>;

  /** Tracks last-fire timestamps per trigger event type. */
  private _lastFire: Map<ContextualTriggerEvent, number> = new Map();

  /** NPCs whose portrait was successfully registered this session. */
  private _npcPortraitCache: Set<string> = new Set();

  /** NPCs whose portrait generation is currently queued or running. */
  private _npcPortraitInFlight: Set<string> = new Set();

  /** Single-slot queue: contextual generations run one at a time. */
  private _queue: Promise<void> = Promise.resolve();

  constructor(options: ContextualTriggerServiceOptions) {
    super(options);
    this._generateAsset =
      options.generateAsset ?? ((request) => generatedAssetWorkflow.generate(request));
    this._saveAsset = options.saveAsset ?? ((request) => generatedAssetWorkflow.save(request));
  }

  /** @inheritdoc */
  setEnabled(value: boolean): void {
    this.enabled = value;
    _writeEnabledPreference(value);
    this.debug('setEnabled', { enabled: value });
  }

  async fireTrigger(options: {
    event: ContextualTriggerEvent;
    context: string;
    characterName?: string;
    npcId?: string;
  }): Promise<{ positive: string; negative: string } | undefined> {
    const { event, context, characterName, npcId } = options;

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

    // NPC dedup: one portrait per NPC per session. A portrait already
    // registered, or already queued, short-circuits — but the cache is only
    // written after a *successful* registration, so a transient failure does
    // not permanently suppress the NPC.
    const npcKey = npcId ?? characterName?.toLowerCase().trim();
    if (
      event === 'npc_introduced' &&
      npcKey &&
      (this._npcPortraitCache.has(npcKey) || this._npcPortraitInFlight.has(npcKey))
    ) {
      this.debug('fireTrigger: NPC portrait already generated', { npcKey });
      return undefined;
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
      npcId,
      compiled: {
        positive: compiled.positive.slice(0, 60),
        negative: compiled.negative.slice(0, 60),
      },
    });

    if (event === 'npc_introduced' && npcId) {
      this._enqueueNpcPortrait({ npcId, npcKey: npcKey ?? npcId, compiled });
    }

    // Resolves now — the generation is fire-and-forget (C-512 AC-2).
    return compiled;
  }

  /** @inheritdoc */
  drain(): Promise<void> {
    return this._queue;
  }

  /**
   * Queues one NPC portrait generation + registration.
   *
   * The queue is single-slot so two triggers can never interleave against a
   * single-slot engine (sd-server rejects a concurrent `generate`).
   */
  private _enqueueNpcPortrait(options: {
    npcId: string;
    npcKey: string;
    compiled: { positive: string; negative: string };
  }): void {
    const { npcId, npcKey, compiled } = options;
    this._npcPortraitInFlight.add(npcKey);

    this._queue = this._queue
      .then(() => this._generateAndRegisterPortrait({ npcId, npcKey, compiled }))
      .catch((error: unknown) => {
        // A failed generation must never interrupt gameplay — log and move on.
        this.error('contextualGeneration:failed', error);
      })
      .finally(() => {
        this._npcPortraitInFlight.delete(npcKey);
      });
  }

  /** Generates and registers one portrait; marks the NPC done only on success. */
  private async _generateAndRegisterPortrait(options: {
    npcId: string;
    npcKey: string;
    compiled: { positive: string; negative: string };
  }): Promise<void> {
    const { npcId, npcKey, compiled } = options;

    const outcome = await this._generateAsset({
      recipeId: NPC_PORTRAIT_RECIPE_ID,
      prompt: compiled.positive,
      negativePrompt: compiled.negative,
      npcId,
    });

    const saved = await this._saveAsset({ tag: outcome.tag });
    if (!saved.registered) {
      this.warn('contextualGeneration:not-registered', {
        npcId,
        tag: saved.tag,
        reason: saved.reason,
      });
      return;
    }

    this._npcPortraitCache.add(npcKey);
    this.debug('contextualGeneration:registered', {
      npcId,
      tag: saved.tag,
      version: saved.version,
      emotion: NPC_PORTRAIT_EMOTION,
    });
  }
}

export const contextualTriggerService: ContextualTriggerServiceInterface =
  ContextualTriggerService.create({
    className: 'ContextualTriggerService',
  });
