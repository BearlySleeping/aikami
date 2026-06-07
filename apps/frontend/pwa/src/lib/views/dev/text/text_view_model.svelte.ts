// apps/frontend/pwa/src/lib/views/dev/text/text_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { logger } from '$logger';

export type TextViewModelInterface = BaseViewModelInterface & {
  /** The user-editable prompt sent to the text generation endpoint. */
  readonly prompt: string;
  /** The accumulated output text from the SSE stream. */
  readonly output: string;
  /** Whether a generation is currently in progress. */
  readonly isGenerating: boolean;
  /** Sends the prompt and begins accumulating SSE chunks. */
  generate(): Promise<void>;
  /** Aborts the active fetch request and resets generation state. */
  cancel(): void;
};

export type TextViewModelOptions = BaseViewModelOptions & {};

class TextViewModel extends BaseViewModel<TextViewModelOptions> implements TextViewModelInterface {
  prompt = $state('');
  output = $state('');
  isGenerating = $state(false);

  private _abortController: AbortController | undefined;

  // ── Public API ────────────────────────────────────────────────────────

  async generate(): Promise<void> {
    this.debug('generate', { promptLength: this.prompt.length });

    if (!this.prompt.trim()) {
      return;
    }

    // Cancel any in-progress generation
    this.cancel();

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    this.isGenerating = true;
    this.output = '';

    try {
      const response = await fetch('/api/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-mode': 'true',
        },
        body: JSON.stringify({ prompt: this.prompt }),
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
    this.debug('cancel');

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

export const getTextViewModel = (options: TextViewModelOptions): TextViewModelInterface =>
  new TextViewModel(options);
