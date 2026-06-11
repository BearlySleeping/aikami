// apps/frontend/client/src/lib/services/character/character_text_stream.svelte.ts
//
// Singleton service for streaming text generation used by the character
// creation wizard. Delegates all SSE streaming and provider resolution to
// the unified AiTextIntelligenceService.
//
// Refactored for C-080: removed raw fetch logic, replaced with
// aiTextIntelligenceService.streamChat().

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { aiTextIntelligenceService } from '../ai/ai_text_intelligence_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CharacterTextStreamInterface = BaseFrontendClassInterface & {
  /** The accumulated output text from the SSE stream. */
  readonly output: string;
  /** Whether a generation is currently in progress. */
  readonly isGenerating: boolean;
  /** Sends the prompt and begins accumulating SSE chunks. */
  generate(options: { prompt: string }): Promise<void>;
  /** Aborts the active fetch request and resets generation state. */
  cancel(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CharacterTextStreamService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements CharacterTextStreamInterface
{
  output = $state('');
  isGenerating = $state(false);

  private _abortController: AbortController | undefined;

  // ── Public API ────────────────────────────────────────────────────────

  async generate(options: { prompt: string }): Promise<void> {
    const { prompt } = options;

    if (!prompt.trim()) {
      return;
    }

    // Cancel any previous stream
    const prevController = this._abortController;
    if (prevController) {
      prevController.abort();
      this._abortController = undefined;
    }
    this.isGenerating = false;

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    this.isGenerating = true;
    this.output = '';

    try {
      this.info('generate:delegating-to-aiTextIntelligenceService', {
        promptLength: prompt.length,
      });

      await aiTextIntelligenceService.streamChat({
        messages: [{ role: 'user', content: prompt }],
        signal,
        onChunk: (text: string) => {
          this.output += text;
        },
      });

      this.info('generate:stream-done', { outputLength: this.output.length });
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        this.debug('generate:aborted');
        return;
      }
      if (this.output.length > 0) {
        this.warn('generate:stream-ended-prematurely', {
          error: (error as Error).message,
          outputLength: this.output.length,
        });
        return;
      }
      this.error('generate:failed', error);
      this.output = `Error: ${(error as Error).message ?? 'Unknown error'}`;
    } finally {
      this.isGenerating = false;
      this._abortController = undefined;
    }
  }

  cancel(): void {
    const controller = this._abortController;
    if (controller) {
      controller.abort();
      this._abortController = undefined;
    }
    this.isGenerating = false;
  }
}

export const characterTextStreamService: CharacterTextStreamInterface =
  CharacterTextStreamService.create({
    className: 'CharacterTextStreamService',
  });
