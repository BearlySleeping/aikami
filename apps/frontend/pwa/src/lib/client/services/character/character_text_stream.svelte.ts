// apps/frontend/pwa/src/lib/client/services/character/character_text_stream.svelte.ts
//
// Singleton service for streaming text generation used by the character
// creation wizard. Provider configuration is sourced from aiSettingsService
// — never hardcoded. Supports SSE streaming with read/fetch timeouts.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { aiSettingsService } from '$services';

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

/** Timeout for the entire fetch+stream operation (90 seconds). */
const FETCH_TIMEOUT_MS = 90_000;

/** Timeout for individual SSE stream read operations (30 seconds). */
const READ_TIMEOUT_MS = 30_000;

/** Maximum time to wait for the first SSE chunk before giving up (15 seconds). */
const FIRST_CHUNK_TIMEOUT_MS = 15_000;

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
      const { apiKey, model, endpoint } = aiSettingsService.textProvider;

      // Use the configured external provider when any setting is populated
      const body: Record<string, string> = { prompt };

      if (apiKey || model || endpoint) {
        body.provider = 'openrouter';
        if (model) {
          body.model = model;
        }
      }

      this.info('generate:fetching', {
        endpoint: endpoint || '(default)',
        model: model || '(default)',
        promptLength: prompt.length,
      });

      const timeoutId = setTimeout(
        () => abortController.abort(new Error('Fetch timed out')),
        FETCH_TIMEOUT_MS,
      );

      const response = await fetch('/api/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      clearTimeout(timeoutId);

      this.info('generate:fetch-done', {
        status: response.status,
        ok: response.ok,
        hasBody: !!response.body,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.error('generate:fetch-failed', { status: response.status, errorText });
        this.output = `Error: ${response.status} — ${errorText}`;
        return;
      }

      if (!response.body) {
        this.error('generate:no-response-body');
        this.output = 'Error: No response body';
        return;
      }

      this.info('generate:reading-stream');
      await this._readStream({ body: response.body, signal });
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

  // ── Private helpers ───────────────────────────────────────────────────

  private async _readStream(options: {
    body: ReadableStream<Uint8Array>;
    signal: AbortSignal;
  }): Promise<void> {
    const { body, signal } = options;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    this.debug('_readStream:start');

    let isFirstChunk = true;

    try {
      while (true) {
        if (signal.aborted) {
          this.debug('_readStream:aborted');
          return;
        }

        const timeout = isFirstChunk ? FIRST_CHUNK_TIMEOUT_MS : READ_TIMEOUT_MS;
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Stream read timed out')), timeout),
          ),
        ]);
        isFirstChunk = false;
        const { value, done } = result;
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            this.debug('_readStream:received-DONE', {
              chunkCount,
              outputLength: this.output.length,
            });
            return;
          }

          try {
            const chunk = JSON.parse(data) as { text?: string };
            if (chunk.text) {
              this.output += chunk.text;
              chunkCount++;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      this.debug('_readStream:done', { chunkCount, outputLength: this.output.length });
      reader.releaseLock();
    }
  }
}

export const characterTextStreamService: CharacterTextStreamInterface =
  CharacterTextStreamService.create({
    className: 'CharacterTextStreamService',
  });
