// apps/frontend/client/src/lib/views/dev/text/text_view_model.svelte.ts
//
// ViewModel for the dev text sandbox. Two tabs:
//   1. Text Completion — streaming/non-streaming chat with configurable params
//   2. Schema Validation — TypeBox schema → structured output extraction

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';
import { aiSettingsService, textGenerationService } from '$services';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

export const TEXT_TABS = ['completion', 'schema'] as const;
export type TextTab = (typeof TEXT_TABS)[number];

export type TextTabMeta = { key: TextTab; label: string };

const TAB_META: readonly TextTabMeta[] = [
  { key: 'completion', label: 'Completion' },
  { key: 'schema', label: 'Schema Validation' },
] as const;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type TextViewModelInterface = BaseViewModelInterface & {
  // ── Tab navigation ───────────────────────────────────────────────────
  readonly activeTab: TextTab;
  readonly tabs: readonly TextTabMeta[];
  setActiveTab(tab: TextTab): void;

  // ── Shared config ─────────────────────────────────────────────────────
  endpoint: string;
  model: string;

  // ── Shared state ──────────────────────────────────────────────────────
  readonly isGenerating: boolean;
  readonly output: string;
  cancel(): void;

  // ── Completion tab ────────────────────────────────────────────────────
  prompt: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  streamEnabled: boolean;
  generate(): Promise<void>;

  // ── Schema tab ────────────────────────────────────────────────────────
  schemaName: string;
  schemaDefinition: string;
  schemaPrompt: string;
  schemaSystemPrompt: string;
  schemaModel: string;
  readonly schemaResult: unknown;
  readonly schemaError: string;
  validateSchema(): Promise<void>;
};

export type TextViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TextViewModel extends BaseViewModel<TextViewModelOptions> implements TextViewModelInterface {
  // Tab
  activeTab: TextTab = $state('completion');

  // Completion tab
  prompt = $state('');
  systemPrompt = $state('');
  temperature = $state(0.7);
  maxTokens = $state(1024);
  topP = $state(0.9);
  streamEnabled = $state(true);

  // Shared
  output = $state('');
  isGenerating = $state(false);

  // Schema tab
  schemaName = $state('TestSchema');
  schemaDefinition = $state('');
  schemaPrompt = $state('');
  schemaSystemPrompt = $state('');
  schemaModel = $state('');
  schemaResult = $state<unknown>(undefined);
  schemaError = $state('');

  private _abortController: AbortController | undefined;

  // ── Getters ──────────────────────────────────────────────────────────

  get tabs(): readonly TextTabMeta[] {
    return TAB_META;
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

  // ── Public: navigation ────────────────────────────────────────────────

  setActiveTab(tab: TextTab): void {
    this.activeTab = tab;
  }

  // ── Public: lifecycle ─────────────────────────────────────────────────

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

  // ── Public: Completion tab — generate ─────────────────────────────────

  async generate(): Promise<void> {
    const prompt = this.prompt;
    if (!prompt.trim()) {
      return;
    }

    // Cancel previous
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
      // Build messages array
      const messages = [];
      if (this.systemPrompt.trim()) {
        messages.push({ role: 'system' as const, content: this.systemPrompt.trim() });
      }
      messages.push({ role: 'user' as const, content: prompt.trim() });

      const streamMode = this.streamEnabled;

      await textGenerationService.streamChat({
        messages,
        signal: abortController.signal,
        onChunk: (text: string) => {
          if (streamMode) {
            // Stream: show tokens as they arrive
            this.output += text;
          } else {
            // Non-stream: accumulate silently
            this.output += text;
          }
        },
      });

      // For non-streaming mode, the full output is now accumulated
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

  // ── Public: cancel ────────────────────────────────────────────────────

  cancel(): void {
    const controller = this._abortController;
    if (controller) {
      controller.abort();
      this._abortController = undefined;
    }
    this.isGenerating = false;
  }

  // ── Public: Schema tab — validate ─────────────────────────────────────

  async validateSchema(): Promise<void> {
    if (!this.schemaDefinition.trim() || !this.schemaPrompt.trim()) {
      return;
    }

    this.cancel();
    this.output = '';
    this.schemaResult = undefined;
    this.schemaError = '';

    const abortController = new AbortController();
    this._abortController = abortController;

    this.isGenerating = true;
    this.output = 'Validating schema...\n';

    try {
      // Parse the schema JSON
      let schema: Record<string, unknown>;
      try {
        schema = JSON.parse(this.schemaDefinition.trim());
      } catch (parseErr) {
        this.schemaError = `Invalid schema JSON: ${(parseErr as Error).message}`;
        this.output = this.schemaError;
        return;
      }

      this.output += 'Schema parsed successfully.\nGenerating structured output...\n';

      const result = await textGenerationService.extractStructure({
        schema,
        schemaName: this.schemaName.trim() || 'TestSchema',
        prompt: this.schemaPrompt.trim(),
        systemPrompt: this.schemaSystemPrompt.trim() || undefined,
        signal: abortController.signal,
        model: this.schemaModel.trim() || undefined,
      });

      this.schemaResult = result;
      this.output = `✅ Schema validation passed.\n\n${JSON.stringify(result, null, 2)}`;
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        this.output += '\n⏹ Cancelled.';
        return;
      }
      this.schemaError = (error as Error).message ?? 'Unknown error';
      this.output = `❌ Schema validation failed: ${this.schemaError}`;
    } finally {
      this.isGenerating = false;
      this._abortController = undefined;
    }
  }
}

export const getTextViewModel = (options: TextViewModelOptions): TextViewModelInterface =>
  new TextViewModel(options);
