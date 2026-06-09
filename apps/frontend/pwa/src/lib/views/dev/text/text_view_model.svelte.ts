// apps/frontend/pwa/src/lib/views/dev/text/text_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';
import { devTextService, type TextGenerationProvider } from '$services';

export type { TextGenerationProvider };

export type TextViewModelInterface = BaseViewModelInterface & {
  /** The user-editable prompt sent to the text generation endpoint. */
  readonly prompt: string;
  /** The accumulated output text from the SSE stream. */
  readonly output: string;
  /** Whether a generation is currently in progress. */
  readonly isGenerating: boolean;
  /** The selected text generation provider. */
  readonly provider: TextGenerationProvider;
  /** The model identifier (used when provider is OpenRouter). */
  readonly model: string;
  /** Sends the prompt and begins accumulating SSE chunks. */
  generate(): Promise<void>;
  /** Aborts the active fetch request and resets generation state. */
  cancel(): void;
};

export type TextViewModelOptions = BaseViewModelOptions & {};

class TextViewModel extends BaseViewModel<TextViewModelOptions> implements TextViewModelInterface {
  prompt = $state('');

  get output(): string {
    return devTextService.output;
  }

  get isGenerating(): boolean {
    return devTextService.isGenerating;
  }

  get provider(): TextGenerationProvider {
    return devTextService.provider;
  }

  set provider(value: TextGenerationProvider) {
    devTextService.provider = value;
  }

  get model(): string {
    return devTextService.model;
  }

  set model(value: string) {
    devTextService.model = value;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Initializes the view model. Supports URL query parameters:
   * - `?instant=true` (or `instant-start=true`) — auto-generate on load
   * - `?text=...` — pre-fill the prompt
   * - `?provider=ollama|openrouter` — set the provider before generating
   */
  override async initialize(): Promise<void> {
    const url = new URL(page.url);
    const instantParam = url.searchParams.get('instant') ?? url.searchParams.get('instant-start');

    // Set provider from URL if specified
    const providerParam = url.searchParams.get('provider');
    if (providerParam === 'ollama' || providerParam === 'openrouter') {
      devTextService.provider = providerParam;
    }

    if (instantParam === 'true') {
      const textParam = url.searchParams.get('text');
      if (textParam) {
        this.prompt = decodeURIComponent(textParam);
        this.debug('initialize:instant-auto', {
          promptLength: this.prompt.length,
          provider: devTextService.provider,
        });
        void this.generate();
      }
    }

    await super.initialize();
  }

  async generate(): Promise<void> {
    await devTextService.generate({ prompt: this.prompt });
  }

  cancel(): void {
    devTextService.cancel();
  }
}

export const getTextViewModel = (options: TextViewModelOptions): TextViewModelInterface =>
  new TextViewModel(options);
