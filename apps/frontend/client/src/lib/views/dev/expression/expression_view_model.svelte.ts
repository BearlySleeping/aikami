// apps/frontend/client/src/lib/views/dev/expression/expression_view_model.svelte.ts
//
// ExpressionDevViewModel — dev sandbox for testing expression detection
// and LPC overlay preview. Provides text input, live detection results,
// catalog browsing, and agent toggle.
//
// Contract: C-239 Expression Emotion System

import {
  BaseDevViewModel,
  type BaseDevViewModelInterface,
  type BaseDevViewModelOptions,
} from '@aikami/frontend/services/base';
import { EXPRESSION_CATALOG } from '$lib/data/expression_catalog';
import type {
  AssetStore,
  ExpressionAssetResolverInterface,
  ExpressionServiceInterface,
} from '$services';
import type { DetectExpressionResult, ExpressionId, ExpressionOverlay } from '$types';

// ── Capability contracts ─────────────────────────────────────────────────

/** Two-tier expression detection performed on behalf of the sandbox. */
export type ExpressionDetectionCapabilities = Pick<ExpressionServiceInterface, 'detectExpression'>;

/** LPC overlay lookup for the previewed expression. */
export type ExpressionResolverCapabilities = Pick<
  ExpressionAssetResolverInterface,
  'resolveLpcOverlays'
>;

/** Asset catalog reads the portrait preview performs. */
export type ExpressionAssetCapabilities = Pick<AssetStore, 'manifest' | 'resolveUrl'>;

// ── Interfaces ───────────────────────────────────────────────────────────

export type ExpressionDevViewModelInterface = BaseDevViewModelInterface & {
  /** Text input for expression detection. */
  readonly inputText: string;
  /** Sets the input text and triggers detection. */
  setInputText(text: string): void;
  /** Whether detection is currently running. */
  readonly isDetecting: boolean;
  /** Result of the most recent detection. */
  readonly detectionResult: DetectExpressionResult | undefined;
  /** Whether the agent toggle is enabled (Tier 1). */
  readonly useAgent: boolean;
  /** Toggles the agent detection on/off. */
  toggleAgent(): void;
  /** All expression catalog entries for browsing. */
  readonly catalogEntries: ReadonlyArray<{
    readonly id: ExpressionId;
    readonly label: string;
    readonly keywords: readonly string[];
  }>;
  /** Currently selected expression for preview. */
  readonly selectedExpressionId: ExpressionId;
  /** Select an expression for preview. */
  selectExpression(expressionId: ExpressionId): void;
  /** LPC overlay paths for the selected expression. */
  readonly selectedOverlays: ExpressionOverlay;
  /** Resolved portrait base image URL. */
  readonly portraitBaseUrl: string;
  /** Character name input for detection scoping. */
  readonly characterNames: string;
  /** Sets the character names input. */
  setCharacterNames(names: string): void;
};

export type ExpressionDevViewModelOptions = BaseDevViewModelOptions & {
  /** Two-tier expression detection. */
  expression: ExpressionDetectionCapabilities;
  /** LPC overlay resolution for previews. */
  resolver: ExpressionResolverCapabilities;
  /** Asset catalog reads for the portrait preview. */
  assets: ExpressionAssetCapabilities;
};

// ── Implementation ───────────────────────────────────────────────────────

class ExpressionDevViewModel
  extends BaseDevViewModel<ExpressionDevViewModelOptions>
  implements ExpressionDevViewModelInterface
{
  inputText = $state('');

  isDetecting = $state(false);

  detectionResult: DetectExpressionResult | undefined = $state(undefined);

  useAgent = $state(true);

  selectedExpressionId: ExpressionId = $state('neutral');

  characterNames = $state('');

  private readonly _expression: ExpressionDetectionCapabilities;
  private readonly _resolver: ExpressionResolverCapabilities;
  private readonly _assets: ExpressionAssetCapabilities;

  readonly catalogEntries = EXPRESSION_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    keywords: entry.keywords,
  }));

  constructor(options: ExpressionDevViewModelOptions) {
    super(options);
    this._expression = options.expression;
    this._resolver = options.resolver;
    this._assets = options.assets;
  }

  get selectedOverlays(): ExpressionOverlay {
    return this._resolver.resolveLpcOverlays(this.selectedExpressionId);
  }

  get portraitBaseUrl(): string {
    if (!this._assets.manifest) {
      return '';
    }
    return this._assets.resolveUrl('sprites:combat:player_portrait') ?? '';
  }

  setInputText(text: string): void {
    this.inputText = text;
    void this._runDetection();
  }

  toggleAgent(): void {
    this.useAgent = !this.useAgent;
    if (this.inputText.trim().length > 0) {
      void this._runDetection();
    }
  }

  selectExpression(expressionId: ExpressionId): void {
    this.selectedExpressionId = expressionId;
  }

  setCharacterNames(names: string): void {
    this.characterNames = names;
    if (this.inputText.trim().length > 0) {
      void this._runDetection();
    }
  }

  // ── Private ────────────────────────────────────────────────────────

  private async _runDetection(): Promise<void> {
    const text = this.inputText.trim();
    if (text.length === 0) {
      this.detectionResult = undefined;
      return;
    }

    this.isDetecting = true;

    try {
      const characters = this.characterNames
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 0);

      const result = await this._expression.detectExpression({
        message: text,
        characters: characters.length > 0 ? characters : undefined,
        useAgent: this.useAgent,
      });

      this.detectionResult = result;
    } catch (error) {
      this.warn('_runDetection: failed', error);
    } finally {
      this.isDetecting = false;
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

export const createExpressionDevViewModel = (
  options: ExpressionDevViewModelOptions,
): ExpressionDevViewModelInterface => ExpressionDevViewModel.create(options);
