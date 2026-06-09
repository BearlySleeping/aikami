// apps/frontend/pwa/src/lib/views/dev/text/text_view_model.svelte.ts
//
// ViewModel for the dev text sandbox. Delegates text generation to
// the unified AiTextIntelligenceService.
//
// Refactored for C-080: removed characterTextStreamService dependency,
// replaced with aiTextIntelligenceService.streamChat().

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';
import { aiSettingsService, aiTextIntelligenceService } from '$services';

export type TextViewModelInterface = BaseViewModelInterface & {
  readonly prompt: string;
  readonly output: string;
  readonly isGenerating: boolean;
  readonly endpoint: string;
  readonly model: string;

  generate(): Promise<void>;
  cancel(): void;
};

export type TextViewModelOptions = BaseViewModelOptions & {};

class TextViewModel extends BaseViewModel<TextViewModelOptions> implements TextViewModelInterface {
  prompt = $state('');
  output = $state('');
  isGenerating = $state(false);

  private _abortController: AbortController | undefined;

  get endpoint(): string {
    return aiSettingsService.textProvider.endpoint;
  }

  set endpoint(value: string) {
    aiSettingsService.setTextProvider({ endpoint: value });
  }

  get model(): string {
    return aiSettingsService.textProvider.model;
  }

  set model(value: string) {
    aiSettingsService.setTextProvider({ model: value });
  }

  // ── Public API ────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    const url = new URL(page.url);
    const instantParam = url.searchParams.get('instant') ?? url.searchParams.get('instant-start');

    const endpointParam = url.searchParams.get('endpoint');
    if (endpointParam) {
      aiSettingsService.setTextProvider({ endpoint: decodeURIComponent(endpointParam) });
    }

    const modelParam = url.searchParams.get('model');
    if (modelParam) {
      aiSettingsService.setTextProvider({ model: decodeURIComponent(modelParam) });
    }

    if (instantParam === 'true') {
      const textParam = url.searchParams.get('text');
      if (textParam) {
        this.prompt = decodeURIComponent(textParam);
        void this.generate();
      }
    }

    await super.initialize();
  }

  async generate(): Promise<void> {
    const prompt = this.prompt;
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

    this.isGenerating = true;
    this.output = '';

    try {
      await aiTextIntelligenceService.streamChat({
        messages: [{ role: 'user', content: prompt }],
        signal: abortController.signal,
        onChunk: (text: string) => {
          this.output += text;
        },
      });
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      if (this.output.length > 0) {
        return;
      }
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

export const getTextViewModel = (options: TextViewModelOptions): TextViewModelInterface =>
  new TextViewModel(options);
