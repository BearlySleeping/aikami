// apps/frontend/pwa/src/lib/client/services/media/dev_text.svelte.ts

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported text generation providers for the dev sandbox. */
export type TextGenerationProvider = 'ollama' | 'openrouter';

/** Default free-tier model used when OpenRouter is selected. */
const DEFAULT_OPENROUTER_MODEL = 'liquid/lfm-2.5-1.2b-instruct:free';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type DevTextServiceInterface = BaseFrontendClassInterface & {
  /** The accumulated output text from the SSE stream. */
  readonly output: string;
  /** Whether a generation is currently in progress. */
  readonly isGenerating: boolean;
  /** The selected text generation provider. */
  provider: TextGenerationProvider;
  /** The model identifier (used when provider is OpenRouter). */
  model: string;
  /** Sends the prompt and begins accumulating SSE chunks. */
  generate(options: { prompt: string }): Promise<void>;
  /** Aborts the active fetch request and resets generation state. */
  cancel(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DevTextService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements DevTextServiceInterface
{
  output = $state('');
  isGenerating = $state(false);
  provider: TextGenerationProvider = $state('ollama');
  model = $state(DEFAULT_OPENROUTER_MODEL);

  private _abortController: AbortController | undefined;

  // ── Public API ────────────────────────────────────────────────────────

  async generate(options: { prompt: string }): Promise<void> {
    const { prompt } = options;

    if (!prompt.trim()) {
      return;
    }

    // Cancel any in-progress generation (inline to avoid proxy auto-logging)
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
      const body: Record<string, string> = { prompt };

      if (this.provider === 'openrouter') {
        body.provider = 'openrouter';
        body.model = this.model || DEFAULT_OPENROUTER_MODEL;
      }

      const response = await fetch('/api/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        logger.error('generate:fetch-failed', { status: response.status, errorText });
        this.output = `Error: ${response.status} — ${errorText}`;
        return;
      }

      if (!response.body) {
        this.output = 'Error: No response body';
        return;
      }

      await this._readStream({ body: response.body, signal });
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        // Silently handled — cancel() was called
        return;
      }
      logger.error('generate:failed', error);
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

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Reads the SSE response body and accumulates text chunks into {@link output}.
   *
   * Parses lines starting with `data: ` as JSON payloads. A `[DONE]` data
   * value signals stream completion. Text chunks are extracted from the
   * `text` property of the JSON payload.
   */
  private async _readStream(options: {
    body: ReadableStream<Uint8Array>;
    signal: AbortSignal;
  }): Promise<void> {
    const { body, signal } = options;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal.aborted) {
          return;
        }

        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        // The last element may be incomplete — keep it in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            return;
          }

          try {
            const chunk = JSON.parse(data) as { text?: string };
            if (chunk.text) {
              this.output += chunk.text;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export const devTextService: DevTextServiceInterface = DevTextService.create({
  className: 'DevTextService',
});
