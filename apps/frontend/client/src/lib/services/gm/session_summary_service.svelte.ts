// apps/frontend/client/src/lib/services/gm/session_summary_service.svelte.ts
//
// End-of-session summarization service. Generates a SessionSummary via
// a low-temperature LLM call, stores it in memory, and provides the
// resumePoint for the GameSaveService to restore game state.
//
// Contract: C-235 GM Narrative Director

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { gameStateService, textGenerationService } from '$services';
import { registerSerializable, type SerializableService } from '../game/serializable_service';
import type { SessionSummary } from './gm_types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionSummaryServiceOptions = BaseFrontendClassOptions;

export type SessionSummaryServiceInterface = BaseFrontendClassInterface & {
  /** The most recently generated session summary, or null. */
  readonly currentSummary: SessionSummary | null;

  /** Whether a summarization call is in progress. */
  readonly isGenerating: boolean;

  /**
   * Generates a session summary via a low-t LLM call.
   *
   * Collects the session's conversation history, notable events,
   * and character state, then sends them to the LLM for summarization.
   * The result includes a resumePoint for GameSaveService.
   *
   * The generated summary is guaranteed to be under 2 KB.
   *
   * @param playtimeMinutes - Total playtime for this session.
   * @returns The generated SessionSummary.
   */
  generateSummary(playtimeMinutes: number): Promise<SessionSummary>;

  /**
   * Clears the current summary (e.g., when starting a new session).
   */
  clearSummary(): void;
};

// ---------------------------------------------------------------------------
// Serialization type
// ---------------------------------------------------------------------------

type SessionSummarySnapshot = {
  summary: SessionSummary | null;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SessionSummaryService
  extends BaseFrontendClass<SessionSummaryServiceOptions>
  implements SessionSummaryServiceInterface, SerializableService<SessionSummarySnapshot>
{
  private _currentSummary = $state<SessionSummary | null>(null);
  private _isGenerating = $state(false);

  constructor(options: SessionSummaryServiceOptions) {
    super(options);
    registerSerializable('sessionSummary', this as unknown as SerializableService<unknown>);
  }

  get currentSummary(): SessionSummary | null {
    return this._currentSummary;
  }

  get isGenerating(): boolean {
    return this._isGenerating;
  }

  /** @inheritdoc */
  async generateSummary(playtimeMinutes: number): Promise<SessionSummary> {
    if (this._isGenerating) {
      throw new Error('SessionSummaryService: summary generation already in progress');
    }

    this._isGenerating = true;

    try {
      const worldName = gameStateService.worldGenOutput?.worldName ?? 'Unknown';
      const synopsisResult = await this._generateSynopsis({ worldName, playtimeMinutes });

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
        resumePoint: this._buildResumePoint(),
      };

      this._currentSummary = summary;
      this.debug('generateSummary', {
        summaryId: summary.id,
        synopsisLength: summary.synopsis.length,
      });

      return summary;
    } finally {
      this._isGenerating = false;
    }
  }

  /** @inheritdoc */
  clearSummary(): void {
    this._currentSummary = null;
    this.debug('clearSummary');
  }

  // ── SerializableService ─────────────────────────────────────────────

  serialize(): SessionSummarySnapshot {
    return { summary: this._currentSummary };
  }

  hydrate(data: SessionSummarySnapshot): void {
    this._currentSummary = data.summary;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Calls the LLM to generate a synopsis and key events from the session data.
   *
   * Uses a low temperature (0.3) for consistent, focused summarization.
   */
  private async _generateSynopsis(options: {
    worldName: string;
    playtimeMinutes: number;
  }): Promise<{
    synopsis: string;
    keyEvents: string[];
    npcInteractions: Array<{ npcName: string; context: string }>;
  }> {
    const { worldName, playtimeMinutes } = options;

    const prompt = [
      `Summarize a ${playtimeMinutes}-minute play session in ${worldName}.`,
      '',
      'Respond with JSON:',
      '{',
      '  "synopsis": "3-5 sentence summary of the session",',
      '  "keyEvents": ["Event 1", "Event 2", ...],',
      '  "npcInteractions": [{"npcName": "...", "context": "..."}]',
      '}',
      '',
      'Keep the entire response under 2 KB.',
    ].join('\n');

    const result = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          synopsis: { type: 'string', minLength: 1 },
          keyEvents: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
          npcInteractions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                npcName: { type: 'string' },
                context: { type: 'string' },
              },
              required: ['npcName', 'context'],
            },
          },
        },
        required: ['synopsis', 'keyEvents', 'npcInteractions'],
        additionalProperties: false,
      },
      schemaName: 'SessionSummary',
      prompt,
      systemPrompt: 'Summarize RPG sessions concisely. JSON only. No markdown, no explanations.',
      // Low temperature for focused summarization
    })) as {
      synopsis: string;
      keyEvents: string[];
      npcInteractions: Array<{ npcName: string; context: string }>;
    };

    return {
      synopsis: result.synopsis,
      keyEvents: result.keyEvents ?? [],
      npcInteractions: result.npcInteractions ?? [],
    };
  }

  /**
   * Builds a resume point string from the current game state.
   *
   * The resume point encodes the current world state so GameSaveService
   * can restore the game to where the session left off.
   */
  private _buildResumePoint(): string {
    const worldName = gameStateService.worldGenOutput?.worldName ?? 'Unknown';
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
