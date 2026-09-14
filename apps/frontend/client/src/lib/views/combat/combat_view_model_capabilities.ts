// apps/frontend/client/src/lib/views/combat/combat_view_model_capabilities.ts
//
// What the combat ViewModel is HANDED: one capability contract per collaborating
// service, plus the options a caller passes to the factory.
//
// Split out of `combat_view_model.svelte.ts` (which had grown past its reviewed
// size exception) so the ViewModel file is behaviour, and its dependency
// contract is declarative and independently reviewable. Every declared field is
// a seam a unit test can substitute, so this file IS the list of what the
// ViewModel is allowed to depend on.
//
// Contract: C-145, C-516, C-525, C-526

import type { EngineBridge } from '@aikami/frontend/engine';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import type { AudioTrackEntry } from '@aikami/schemas';
import type {
  CombatAiDecisionRequest,
  CombatAiDecisionResult,
  CombatNarrationRequest,
  CombatNarrationResult,
  CombatState,
  CompanionControlMode,
  IntentInterpreterResult,
  WorldGenOutput,
} from '@aikami/types';
import type { ExpressionId } from '$types';
import type { CombatLogServiceInterface } from './combat_log_service.svelte.ts';
import type { StatusEffectsServiceInterface } from './status_effects_service.svelte.ts';

// ── Capability contracts ────────────────────────────────────────────────

/** Creates the engine bridge the ViewModel talks to (loaded lazily in production). */
export type CombatEngineCapabilities = {
  createBridge(): Promise<EngineBridge>;
};

/**
 * Natural-language intent capabilities (C-525).
 *
 * The ViewModel never reaches into the service registry: production wiring
 * injects the interpreter (model + deterministic fallback) and the feature
 * flag, so unit tests exercise the whole decision loop without a provider.
 */
export type CombatIntentCapabilities = {
  /** Kill switch (C-525 Migration & Rollback) — off means no language surface. */
  readonly enabled: boolean;
  /** Model interpretation with deterministic-parser fallback. */
  interpretWithFallback(request: {
    requestId: string;
    intentId: string;
    encounterId: string;
    actorId: string;
    basedOnRevision: number;
    text: string;
    state: CombatState;
  }): Promise<IntentInterpreterResult>;
  /** Cancels one outstanding interpretation by request id. */
  cancel(requestId: string): void;
};

/**
 * LLM outcome narration (C-526 AC-11).
 *
 * Optional and FIRE-AND-FORGET: absent means the authored template is the only
 * narration path — exactly what the kill switch does. The ViewModel never
 * awaits it, so neither the next mechanical step nor the UI waits on the model.
 */
export type CombatNarrationCapabilities = {
  /** Pinned `PUBLIC_COMBAT_LLM_AGENTS` value for this encounter (AC-9). */
  readonly enabled: boolean;
  /** Narrates one resolved action; never throws (template fallback). */
  narrate(request: CombatNarrationRequest): Promise<CombatNarrationResult>;
  /** Cancels every outstanding narration (encounter ended / disposed). */
  cancelAll(): void;
};

/**
 * Companion control modes (C-526 AC-6).
 *
 * Optional: absent means no companion surface — companions stay AI-driven, which
 * is the pre-526 behaviour. The PARTY ROSTER owns persistence; the ViewModel only
 * reads and writes through this seam.
 */
export type CombatCompanionCapabilities = {
  /** Whether this combatant is a recruited companion. */
  isCompanion(combatantId: string): boolean;
  /** The recruited companions, for the mode selector. */
  list(): Array<{ combatantId: string; name: string }>;
  /** The persisted mode for a companion. */
  modeFor(combatantId: string): CompanionControlMode;
  /** The persisted standing goal for Intent mode (empty when none). */
  intentFor(combatantId: string): string;
  /** Persists a mode/intent change so it survives the encounter. */
  persist(change: { combatantId: string; mode: CompanionControlMode; intent: string }): void;
};

/**
 * The client half of the deferred AI turn (C-526 AC-5).
 *
 * Optional: absent means the engine never defers — with the flag off it owns
 * every AI turn itself (AC-9).
 */
export type CombatAiTurnCapabilities = {
  readonly enabled: boolean;
  decide(request: CombatAiDecisionRequest): Promise<CombatAiDecisionResult>;
  decideBatch(requests: readonly CombatAiDecisionRequest[]): Promise<CombatAiDecisionResult[]>;
  cancel(decisionId: string): void;
  cancelAll(): void;
};

/** Image-generation state and requests consumed by the combat view. */
export type CombatImageCapabilities = {
  readonly isGenerating: boolean;
  readonly generationStatus: string;
  readonly generationProgress: number;
  generateImage(options: { prompt: string }): Promise<{ url: string; isDemo: boolean }>;
};

/** LLM structured-output extraction used for freeform combat actions. */
export type CombatTextCapabilities = {
  extractStructure(options: {
    schema: Record<string, unknown>;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
  }): Promise<unknown>;
};

/** Text-to-speech used for enemy taunts and gatekeeping narration. */
export type CombatTtsCapabilities = {
  synthesize(options: { text: string; voice: string }): Promise<void>;
};

/** Dice notation resolution for queued rolls. */
export type CombatDiceCapabilities = {
  rollNotation(options: { count: number; sides: number; label?: string }): number;
};

/** Static audio catalog + BGM playback used by the AI Director. */
export type CombatAudioCapabilities = {
  getTracksByMood(mood: string): Promise<readonly AudioTrackEntry[]>;
  resolveAudioTrackUrl(entry: AudioTrackEntry): Promise<string>;
  transitionToBgm(trackUrl: string, durationMs?: number): Promise<void>;
  playSceneBgm(scene: 'explore' | 'combat', durationMs?: number): Promise<void>;
};

/** LPC expression overlay resolution for portraits. */
export type CombatExpressionCapabilities = {
  resolveLpcOverlays(expressionId: ExpressionId): {
    readonly eyes?: string;
    readonly eyebrows?: string;
    readonly mouth?: string;
  };
};

/** Player identity fields the portrait reads. */
export type CombatPlayerStateCapabilities = {
  readonly classId: string;
};

/** Player inventory read by the character-sheet context builder. */
export type CombatInventoryCapabilities = {
  readonly inventory: ReadonlyArray<{ readonly itemId: string; readonly quantity: number }>;
};

/** World-generation state read by the character-sheet context builder. */
export type CombatWorldStateCapabilities = {
  readonly worldGenOutput: WorldGenOutput | undefined;
};

/** GM prompt assembly for world context injection. */
export type CombatWorldGenCapabilities = {
  assembleGmPrompt(options: { output: WorldGenOutput; playerGoals: string }): string;
};

/** Combat-log domain helpers. */
export type CombatLogCapabilities = Pick<
  CombatLogServiceInterface,
  'parseActor' | 'updateEntryImage'
>;

/** Status-effect + death-save domain helpers. */
export type CombatStatusEffectsCapabilities = Pick<
  StatusEffectsServiceInterface,
  | 'playerStatusEffects'
  | 'enemyStatusEffects'
  | 'deathSaveState'
  | 'isAnyEntityDowned'
  | 'reset'
  | 'applyStatus'
  | 'expireStatus'
  | 'setEntityDowned'
  | 'setDeathSave'
  | 'revive'
>;

/** Options accepted by callers of the production factory (no wiring). */
export type CombatViewModelPublicOptions = BaseViewModelOptions & {
  /**
   * Optional callback invoked when the user dismisses the battle result.
   * When provided, {@link dismissResult} calls this instead of just
   * clearing the result — allowing the parent to close the overlay.
   */
  onDismissOverlay?: () => void;
};

export type CombatViewModelOptions = CombatViewModelPublicOptions & {
  /** Engine bridge factory. */
  engine: CombatEngineCapabilities;
  /** Image generation state + requests. */
  images: CombatImageCapabilities;
  /** LLM structured-output extraction. */
  text: CombatTextCapabilities;
  /** Text-to-speech synthesis. */
  tts: CombatTtsCapabilities;
  /** Dice notation resolution. */
  dice: CombatDiceCapabilities;
  /** Audio catalog + BGM playback. */
  audio: CombatAudioCapabilities;
  /** LPC expression overlay resolution. */
  expressions: CombatExpressionCapabilities;
  /** Player identity state. */
  playerState: CombatPlayerStateCapabilities;
  /** Player inventory. */
  inventory: CombatInventoryCapabilities;
  /** World-generation state. */
  worldState: CombatWorldStateCapabilities;
  /** World-context GM prompt assembly. */
  worldGen: CombatWorldGenCapabilities;
  /** Combat-log domain helpers. */
  combatLog: CombatLogCapabilities;
  /** Status-effect + death-save domain helpers. */
  statusEffects: CombatStatusEffectsCapabilities;
  /**
   * Natural-language intent interpretation (C-525).
   *
   * Optional: absent means the language surface is off (a sandbox or a test
   * that does not exercise it), which is exactly what the kill switch does.
   */
  intent?: CombatIntentCapabilities;
  /**
   * Outcome narration (C-526 AC-11).
   *
   * Optional: absent means the authored template is the only narration path.
   */
  narration?: CombatNarrationCapabilities;
  /**
   * Deferred AI turns (C-526 AC-5).
   *
   * Optional: absent means the engine owns every AI turn deterministically.
   */
  aiTurns?: CombatAiTurnCapabilities;
  /**
   * Companion control modes (C-526 AC-6).
   *
   * Optional: absent means companions remain AI-driven with no approval surface.
   */
  companions?: CombatCompanionCapabilities;
};
