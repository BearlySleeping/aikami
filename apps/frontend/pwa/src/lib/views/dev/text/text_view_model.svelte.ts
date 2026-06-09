// apps/frontend/pwa/src/lib/views/dev/text/text_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';
import { aiSettingsService, characterTextStreamService } from '$services';

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

  get output(): string {
    return characterTextStreamService.output;
  }

  get isGenerating(): boolean {
    return characterTextStreamService.isGenerating;
  }

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
    await characterTextStreamService.generate({ prompt: this.prompt });
  }

  cancel(): void {
    characterTextStreamService.cancel();
  }
}

export const getTextViewModel = (options: TextViewModelOptions): TextViewModelInterface =>
  new TextViewModel(options);
