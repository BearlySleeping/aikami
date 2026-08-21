// apps/frontend/client/src/lib/views/combat/combat_log_service.svelte.ts
//
// Sub-service owning the combat-log entry domain logic (C-165). Extracted
// from combat_view_model.svelte.ts (C-425).
//
// Owns how a structured CombatLogEntry is created, how the actor is parsed
// from an engine message, and how an entry's inline image is updated. It is a
// pure, focused object — it does NOT reach back into its parent ViewModel and
// holds no shared mutable state; the parent keeps the reactive `combatLog`
// array and delegates these operations here.
//
// Contract: C-425 ViewModel Decomposition
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ── Types ────────────────────────────────────────────────────────────────

/**
 * A single entry in the combat log, replacing the old flat string format.
 * Each entry tracks its turn, actor, narrative text, and optionally an
 * AI-generated inline image.
 *
 * Contract: C-165 Combat Inline Images & Gallery
 */
export type CombatLogEntry = {
  /** Unique ID for Svelte {#each} keying. */
  readonly id: string;
  /** Turn number this entry belongs to (monotonically increasing). */
  readonly turnNumber: number;
  /** Who performed the action — 'Player' or the enemy name. */
  readonly actor: string;
  /** Description of the action taken. */
  readonly actionText: string;
  /** Outcome or result of the action, if distinct from actionText. */
  readonly outcomeText: string;
  /** AI-generated image URL for this combat turn, if available. */
  readonly imageUrl?: string;
  /** Whether an image is currently being generated for this entry. */
  readonly isGeneratingImage?: boolean;
};

export type CombatLogServiceOptions = BaseViewModelOptions & {};

export type CombatLogServiceInterface = BaseViewModelInterface & {
  /**
   * Parses the actor name from a COMBAT_LOG engine message.
   * Messages follow the pattern "Player rolls..." or "Enemy attacks...".
   * Fallback to "System" if unrecognized.
   */
  parseActor(message: string, enemyName: string): string;
  /** Builds a structured CombatLogEntry from its parts. */
  createEntry(input: {
    id: string;
    turnNumber: number;
    actor: string;
    actionText: string;
    outcomeText?: string;
    imageUrl?: string;
    isGeneratingImage?: boolean;
  }): CombatLogEntry;
  /**
   * Returns a new entries array with the entry matching `entryId` updated to
   * carry the given imageUrl (or clearing isGeneratingImage). No-op if the
   * ID is not found.
   */
  updateEntryImage(
    entries: readonly CombatLogEntry[],
    entryId: string,
    imageUrl: string | undefined,
  ): CombatLogEntry[];
};

// ── Implementation ───────────────────────────────────────────────────────

export class CombatLogService
  extends BaseViewModel<CombatLogServiceOptions>
  implements CombatLogServiceInterface
{
  /** @inheritdoc */
  parseActor(message: string, enemyName: string): string {
    if (message.startsWith('Player ')) {
      return 'Player';
    }
    if (message.startsWith('Enemy ')) {
      return enemyName || 'Enemy';
    }
    return 'System';
  }

  /** @inheritdoc */
  createEntry(input: {
    id: string;
    turnNumber: number;
    actor: string;
    actionText: string;
    outcomeText?: string;
    imageUrl?: string;
    isGeneratingImage?: boolean;
  }): CombatLogEntry {
    return {
      id: input.id,
      turnNumber: input.turnNumber,
      actor: input.actor,
      actionText: input.actionText,
      outcomeText: input.outcomeText ?? '',
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.isGeneratingImage !== undefined
        ? { isGeneratingImage: input.isGeneratingImage }
        : {}),
    };
  }

  /** @inheritdoc */
  updateEntryImage(
    entries: readonly CombatLogEntry[],
    entryId: string,
    imageUrl: string | undefined,
  ): CombatLogEntry[] {
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx === -1) {
      return [...entries];
    }
    const old = entries[idx];
    const updated: CombatLogEntry = {
      ...old,
      imageUrl: imageUrl ?? old.imageUrl,
      isGeneratingImage: false,
    };
    const copy = [...entries];
    copy[idx] = updated;
    return copy;
  }
}

export const getCombatLogService = (options: CombatLogServiceOptions): CombatLogServiceInterface =>
  CombatLogService.create(options);
