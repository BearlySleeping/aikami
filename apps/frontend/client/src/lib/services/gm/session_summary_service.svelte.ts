// apps/frontend/client/src/lib/services/gm/session_summary_service.svelte.ts
//
// End-of-session summarization service. Builds a SessionSummary from
// recorded conversation evidence, stores it in memory, and provides the
// resumePoint for the GameSaveService to restore game state.
//
// Contract: C-235 GM Narrative Director

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { readConversationRecap } from '$lib/utils/journal/conversation_recap.ts';
import type { SessionSummary } from '$types';
import { campaignService } from '../campaign/campaign_service.svelte.ts';
import { playerJournalService } from '../game/player_journal_service.svelte.ts';
import { registerSerializable, type SerializableService } from '../game/serializable_service';
import { worldStateService } from '../game/world_state_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionSummaryServiceOptions = BaseFrontendClassOptions;

export type SessionSummaryServiceInterface = BaseFrontendClassInterface & {
  /** The most recently generated session summary, or null. */
  readonly currentSummary: SessionSummary | null;

  /** Whether a summarization call is in progress. */
  readonly isGenerating: boolean;
  /** NPC dialogue can warrant a summary even when the GM chat is empty. */
  readonly hasDialogue: boolean;

  /**
   * Builds a bounded, factual summary from local conversation records.
   * No provider call is required; unrecorded events are never invented.
   * The result includes a resumePoint for GameSaveService.
   *
   * Synopsis prose is bounded; key events include every matching recap.
   *
   * @param options - Session number and total playtime for this session.
   * @returns The generated SessionSummary.
   */
  generateSummary(options: {
    playtimeMinutes: number;
    sessionNumber: number;
  }): Promise<SessionSummary>;

  /**
   * Clears the current summary (e.g., when starting a new session).
   */
  clearSummary(): void;
};

// ---------------------------------------------------------------------------
// Serialization type
// ---------------------------------------------------------------------------

type SessionSummarySnapshot = {
  campaignId?: string;
  summary: SessionSummary | null;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SessionSummaryService
  extends BaseFrontendClass<SessionSummaryServiceOptions>
  implements SessionSummaryServiceInterface, SerializableService<SessionSummarySnapshot>
{
  private _generation = 0;
  private _summaryCampaignId: string | undefined;
  private _currentSummary = $state<SessionSummary | null>(null);
  private _isGenerating = $state(false);

  constructor(options: SessionSummaryServiceOptions) {
    super(options);
    registerSerializable('sessionSummary', this as unknown as SerializableService<unknown>); // guard-ignore lint/type-safety/casting: registerSerializable call - service typed as SerializableService at runtime
  }

  get currentSummary(): SessionSummary | null {
    if (this._summaryCampaignId !== campaignService.activeCampaign?.id) {
      return null;
    }
    return this._currentSummary;
  }

  get isGenerating(): boolean {
    return this._isGenerating;
  }

  get hasDialogue(): boolean {
    return playerJournalService.entries.some(
      (entry) =>
        entry.campaignId === campaignService.activeCampaign?.id &&
        readConversationRecap(entry) !== undefined,
    );
  }

  /** @inheritdoc */
  async generateSummary(options: {
    playtimeMinutes: number;
    sessionNumber: number;
  }): Promise<SessionSummary> {
    const { playtimeMinutes, sessionNumber } = options;
    if (this._isGenerating) {
      throw new Error('SessionSummaryService: summary generation already in progress');
    }

    this._isGenerating = true;
    const generation = this._generation;
    const campaignId = campaignService.activeCampaign?.id;
    const resumePoint = this._buildResumePoint();

    try {
      const worldName = worldStateService.worldGenOutput?.worldName ?? 'Unknown';
      const synopsisResult = await this._generateSynopsis({
        worldName,
        playtimeMinutes,
        sessionNumber,
      });
      if (generation !== this._generation || campaignId !== campaignService.activeCampaign?.id) {
        throw new Error('Session summary invalidated by campaign change or hydration');
      }

      const summary: SessionSummary = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        playtimeMinutes,
        synopsis: synopsisResult.synopsis,
        keyEvents: synopsisResult.keyEvents,
        npcInteractions: synopsisResult.npcInteractions,
        characterProgression: {
          levelsGained: 0, // TODO: wire to level-up system
          itemsAcquired: [], // TODO: wire to inventory system
          questsCompleted: [], // TODO: wire to quest system
        },
        resumePoint,
      };

      this._summaryCampaignId = campaignId;
      this._currentSummary = summary;
      this.debug('generateSummary', {
        summaryId: summary.id,
        synopsisLength: summary.synopsis.length,
      });

      return summary;
    } finally {
      if (generation === this._generation) {
        this._isGenerating = false;
      }
    }
  }

  /** @inheritdoc */
  clearSummary(): void {
    this._generation++;
    this._isGenerating = false;
    this._currentSummary = null;
    this.debug('clearSummary');
  }

  // ── SerializableService ─────────────────────────────────────────────

  serialize(): SessionSummarySnapshot {
    return { campaignId: this._summaryCampaignId, summary: this.currentSummary };
  }

  hydrate(data: SessionSummarySnapshot): void {
    this._generation++;
    this._isGenerating = false;
    this._summaryCampaignId = data.campaignId ?? campaignService.activeCampaign?.id;
    this._currentSummary = data.summary;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /** Projects session device records, keeping quotes attributed and prose bounded. */
  private async _generateSynopsis(options: {
    worldName: string;
    playtimeMinutes: number;
    sessionNumber: number;
  }): Promise<{
    synopsis: string;
    keyEvents: string[];
    npcInteractions: Array<{ npcName: string; context: string }>;
  }> {
    const recaps = playerJournalService.entries
      .filter(
        (entry) =>
          entry.campaignId === campaignService.activeCampaign?.id &&
          entry.sessionNumber === options.sessionNumber,
      )
      .flatMap((entry) => {
        const recap = readConversationRecap(entry);
        return recap ? [recap] : [];
      });
    // The former prompt contained only world name and duration, no events.
    // Never ask a model to invent a session: use recorded, attributed evidence.
    return {
      synopsis:
        recaps
          .map((recap) => recap.objective)
          .join('\n\n')
          .slice(0, 1200) ||
        `No recorded conversations in ${options.worldName} during this ${options.playtimeMinutes}-minute session.`,
      keyEvents: recaps.map((recap) => recap.title),
      npcInteractions: [],
    };
  }

  /**
   * Builds a resume point string from the current game state.
   *
   * The resume point encodes the current world state so GameSaveService
   * can restore the game to where the session left off.
   */
  private _buildResumePoint(): string {
    const worldName = worldStateService.worldGenOutput?.worldName ?? 'Unknown';
    const timestamp = Date.now();
    return `resume:${worldName}:${timestamp}`;
  }
}

export { SessionSummaryService };

/**
 * Shared singleton instance of the session summary service.
 */
export const sessionSummaryService: SessionSummaryServiceInterface = SessionSummaryService.create({
  className: 'SessionSummaryService',
}) as SessionSummaryServiceInterface;
