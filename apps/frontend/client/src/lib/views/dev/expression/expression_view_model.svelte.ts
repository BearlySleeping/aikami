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
} from '@aikami/frontend/services';
import { EXPRESSION_CATALOG } from '$lib/data/expression_catalog';
import { expressionService, getExpressionAssetResolver } from '$services';
import type { DetectExpressionResult, ExpressionId, ExpressionOverlay } from '$types';

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
  /** Character name input for detection scoping. */
  readonly characterNames: string;
  /** Sets the character names input. */
  setCharacterNames(names: string): void;
};

export type ExpressionDevViewModelOptions = BaseDevViewModelOptions & {};

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

  private _resolver = getExpressionAssetResolver({ className: 'DevExpressionResolver' });

  readonly catalogEntries = EXPRESSION_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    keywords: entry.keywords,
  }));

  get selectedOverlays(): ExpressionOverlay {
    return this._resolver.resolveLpcOverlays(this.selectedExpressionId);
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

      const result = await expressionService.detectExpression({
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

export const getExpressionDevViewModel = (
  options: ExpressionDevViewModelOptions,
): ExpressionDevViewModelInterface => ExpressionDevViewModel.create(options);
