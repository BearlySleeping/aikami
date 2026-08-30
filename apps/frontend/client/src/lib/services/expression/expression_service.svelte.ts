// apps/frontend/client/src/lib/services/expression/expression_service.svelte.ts
//
// ExpressionService — two-tier expression detection (agent + keyword fallback)
// and LPC overlay resolution for character portrait rendering.
//
// Contract: C-239 Expression Emotion System
import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services';
import {
  EXPRESSION_CATALOG,
  getExpressionEntry,
  getKeywordRegex,
} from '$lib/data/expression_catalog';
import { textGenerationService } from '$services';
import type {
  DetectExpressionOptions,
  DetectExpressionResult,
  ExpressionEntry,
  ExpressionId,
  ExpressionMap,
  ExpressionOverlay,
  ExpressionServiceOptions,
} from '$types';
import type { ExpressionOutput } from '../agent/agent_schemas.ts';

// ── Service Interface ────────────────────────────────────────────────────

export type ExpressionServiceInterface = BaseFrontendClassInterface & {
  /**
   * Two-tier expression detection.
   *
   * Tier 1: Agent-based detection via textGenerationService.extractStructure.
   * Tier 2 (fallback): Keyword regex scanning against the expression catalog.
   *
   * @param options - Detection options (message text, optional characters, agent toggle).
   * @returns Expression map with character-name-to-expression-ID mapping.
   */
  detectExpression(options: DetectExpressionOptions): Promise<DetectExpressionResult>;

  /**
   * Resolves LPC overlay asset paths for a given expression ID.
   *
   * Delegates to the expression catalog — returns an ExpressionOverlay
   * with paths for eyes, eyebrows, and mouth (each optional).
   *
   * @param expressionId - Canonical expression identifier.
   * @returns LPC overlay asset paths (may have missing keys).
   */
  resolveLpcOverlays(expressionId: ExpressionId): ExpressionOverlay;

  /**
   * Returns all expression catalog entries for UI browsing.
   */
  readonly catalogEntries: ReadonlyArray<{
    readonly id: ExpressionId;
    readonly label: string;
    readonly keywords: readonly string[];
  }>;

  /**
   * Returns an expression entry by ID, or undefined if not found.
   */
  getEntry(expressionId: ExpressionId): ExpressionEntry | undefined;
};

// ── Implementation ───────────────────────────────────────────────────────

/**
 * Maps freeform agent mood labels to canonical ExpressionId values.
 * Unknown labels are treated as unrecognized (see _isRecognizedMood) —
 * callers decide whether to fall back to keyword detection.
 */
const MOOD_TO_EXPRESSION_ID: Record<string, ExpressionId> = {
  neutral: 'neutral',
  happy: 'happy',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  fearful: 'fearful',
  fear: 'fearful',
  disgusted: 'disgusted',
  disgust: 'disgusted',
  amused: 'amused',
  annoyed: 'annoyed',
  blushing: 'blushing',
  blush: 'blushing',
  confused: 'confused',
  determined: 'determined',
  flirty: 'flirty',
  innocent: 'innocent',
  mischievous: 'mischievous',
  pained: 'pained',
  relieved: 'relieved',
  sleepy: 'sleepy',
  tired: 'sleepy',
  thoughtful: 'thoughtful',
  pensive: 'thoughtful',
  excited: 'happy',
  joyful: 'happy',
  sorrowful: 'sad',
  furious: 'angry',
  enraged: 'angry',
  shocked: 'surprised',
  terrified: 'fearful',
  horrified: 'fearful',
};

class ExpressionService
  extends BaseFrontendClass<ExpressionServiceOptions>
  implements ExpressionServiceInterface
{
  readonly catalogEntries = EXPRESSION_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    keywords: entry.keywords,
  }));

  getEntry(expressionId: ExpressionId): ExpressionEntry | undefined {
    return getExpressionEntry(expressionId);
  }

  async detectExpression(options: DetectExpressionOptions): Promise<DetectExpressionResult> {
    const { message, characters, useAgent, availableExpressions } = options;

    // ── Tier 1: Agent-based detection ──
    if (useAgent !== false) {
      try {
        const agentResult = await this._runAgentDetection({
          message,
          characters,
          availableExpressions,
        });
        if (agentResult) {
          return agentResult;
        }
      } catch (error) {
        this.warn('ExpressionService: agent detection failed, falling back to keyword', {
          error: (error as Error).message,
        });
      }
    }

    // ── Tier 2: Keyword fallback ──
    return this._detectKeyword({ message, characters });
  }

  resolveLpcOverlays(expressionId: ExpressionId): ExpressionOverlay {
    const entry = getExpressionEntry(expressionId);
    if (!entry) {
      this.warn('ExpressionService: no catalog entry for expression', { expressionId });
      return {};
    }
    return entry.lpcOverlays;
  }

  // ── Private ────────────────────────────────────────────────────────

  /**
   * Runs Tier 1 agent-based expression detection.
   *
   * Calls textGenerationService.extractStructure with the multi-character
   * expression schema. On success, maps agent moods to ExpressionId values.
   *
   * @returns Expression detection result, or undefined if agent fails.
   */
  private async _runAgentDetection(options: {
    message: string;
    characters?: string[];
    availableExpressions?: readonly string[];
  }): Promise<DetectExpressionResult | undefined> {
    const { message, characters } = options;

    // NOTE: the expression field is intentionally left unconstrained (plain
    // string). Free models frequently return synonyms, capitalized labels, or
    // multi-word moods that a strict enum would reject — validation-failed
    // warnings on every dialogue turn. The runtime maps freeform moods to
    // canonical ExpressionIds via _mapMoodToExpressionId (unknown → neutral).
    const prompt = [
      'Analyze the following message and determine character expressions.',
      '',
      'Message:',
      message.slice(0, 2000),
      '',
      'Return an array of characters with their current emotional expression.',
    ].join('\n');

    const raw = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          characters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                expression: { type: 'string' },
              },
              required: ['name', 'expression'],
              additionalProperties: false,
            },
          },
        },
        required: ['characters'],
        additionalProperties: false,
      },
      schemaName: 'Expression',
      prompt,
      systemPrompt:
        'Determine character emotional expressions from dialogue. Return JSON with characters array.',
    })) as ExpressionOutput;

    // Map agent output to expression map
    const expressionMap: ExpressionMap = {};
    const characters_ = (raw as { characters?: Array<{ name: string; expression: string }> })
      .characters;
    if (characters_ && Array.isArray(characters_)) {
      for (const char of characters_) {
        // Unrecognized freeform labels (e.g. "very happy") must NOT silently
        // degrade to a successful neutral result — that would suppress the
        // keyword fallback. Return undefined so detectExpression falls
        // through to Tier 2 keyword detection.
        if (!this._isRecognizedMood(char.expression)) {
          this.debug(
            'ExpressionService: agent returned unrecognized mood — falling back to keyword',
            { expression: char.expression },
          );
          return undefined;
        }
        const exprId = this._mapMoodToExpressionId(char.expression);
        expressionMap[char.name] = exprId;
      }
    }

    // Filter to requested characters if provided
    if (characters && characters.length > 0) {
      for (const key of Object.keys(expressionMap)) {
        if (!characters.includes(key)) {
          delete expressionMap[key];
        }
      }
      // Fill missing characters with neutral
      for (const char of characters) {
        if (!expressionMap[char]) {
          expressionMap[char] = 'neutral';
        }
      }
    }

    // If no characters found, default to 'speaker' with neutral
    if (Object.keys(expressionMap).length === 0) {
      expressionMap.speaker = 'neutral';
    }

    return {
      expressionMap,
      detectionTier: 'agent',
    };
  }

  /**
   * Tier 2 keyword-based expression detection.
   *
   * Scans message text against keyword patterns from the expression catalog.
   * Priority: first match in the text wins. If multiple expressions match
   * at the same position, neutral is returned.
   *
   * @returns Expression detection result.
   */
  private _detectKeyword(options: {
    message: string;
    characters?: string[];
  }): DetectExpressionResult {
    const { message, characters } = options;

    // Determine which character slots to fill
    const characterNames = characters && characters.length > 0 ? characters : ['speaker'];

    // Detect expression for the primary character (first in list)
    const expressionId = this._scanKeywords(message);

    const expressionMap: ExpressionMap = {};
    for (const name of characterNames) {
      expressionMap[name] = expressionId;
    }

    return {
      expressionMap,
      detectionTier: 'keyword',
    };
  }

  /**
   * Scans message text against all catalog keyword patterns.
   *
   * Returns the first matching expression by position in the text.
   * If multiple expressions match at the same position, falls back to neutral.
   *
   * @param message - The message text to scan.
   * @returns Best matching expression ID.
   */
  private _scanKeywords(message: string): ExpressionId {
    let bestExpression: ExpressionId = 'neutral';
    let bestPosition = Number.POSITIVE_INFINITY;
    let tieDetected = false;

    for (const entry of EXPRESSION_CATALOG) {
      const regex = getKeywordRegex(entry.id);
      regex.lastIndex = 0;
      const match = regex.exec(message);
      if (!match) {
        continue;
      }

      const position = match.index;

      if (position < bestPosition) {
        bestPosition = position;
        bestExpression = entry.id;
        tieDetected = false;
      } else if (position === bestPosition) {
        tieDetected = true;
      }
    }

    // If tie at same position, use neutral
    if (tieDetected) {
      this.debug('ExpressionService: keyword tie detected, falling back to neutral', {
        messagePreview: message.slice(0, 80),
      });
      return 'neutral';
    }

    return bestExpression;
  }

  /**
   * Maps agent mood labels to canonical ExpressionId values.
   *
   * The expression agent may return freeform mood strings; this maps
   * common moods to our 19-expression catalog. Unknown moods fall back
   * to 'neutral'.
   *
   * @param mood - Mood label from the expression agent.
   * @returns Canonical ExpressionId.
   */
  private _mapMoodToExpressionId(mood: string): ExpressionId {
    const normalized = mood.toLowerCase().trim();
    return MOOD_TO_EXPRESSION_ID[normalized] ?? 'neutral';
  }

  /** Returns true when the mood label is a recognized mapping target. */
  private _isRecognizedMood(mood: string): boolean {
    const normalized = mood.toLowerCase().trim();
    return normalized in MOOD_TO_EXPRESSION_ID;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const expressionService: ExpressionServiceInterface = ExpressionService.create({
  className: 'ExpressionService',
});
