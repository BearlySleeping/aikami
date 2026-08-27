// apps/frontend/client/src/lib/views/dev/lpc_ai/lpc_ai_test_view_model.svelte.ts
//
// LPC AI Recipe Tester ViewModel — paste AI-generated lpcRecipe JSON,
// validate assets against the generated catalog, and preview the character
// with diagnostic feedback for missing/wrong asset IDs.

import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { getLpcCatalog } from '$lib/data/lpc_asset_catalog';

// ── Types ────────────────────────────────────────────────────────────────

/** Per-slot diagnostic entry. */
export type SlotDiagnostic = {
  slot: string;
  status: 'configured' | 'missing_asset' | 'missing_slot';
  assetId: string | undefined;
  message: string;
};

export type LpcAiTestViewModelInterface = BaseViewModelInterface & {
  /** Raw JSON pasted by user. */
  rawJson: string;
  /** Parsed recipe (slot → assetId). */
  parsedRecipe: Record<string, string> | null;
  /** Per-slot diagnostics after parsing. */
  diagnostics: SlotDiagnostic[];
  /** Error message if parsing failed. */
  parseError: string | null;
  /** LPC layer recipes for the preview renderer. */
  recipes: readonly LpcLayerRecipe[];
  /** How many slots were configured. */
  readonly configuredCount: number;
  /** How many slots had missing assets. */
  readonly missingCount: number;
  /** Whether the parse succeeded and recipes are available. */
  readonly hasRecipes: boolean;

  /** Parse the raw JSON and build diagnostics + recipes. */
  parseRecipe(): void;
  /** Load a sample recipe for quick testing. */
  loadSample(): void;
  /** Clear everything. */
  clear(): void;
};

export type LpcAiTestViewModelOptions = BaseViewModelOptions & {};

// ── Helpers ──────────────────────────────────────────────────────────────

/** Builds lookup: assetId → { slot, variantIndex } from generated catalog. */
const _buildAssetLookup = (): Map<string, { slot: string; variantIndex: number }> => {
  const lookup = new Map<string, { slot: string; variantIndex: number }>();
  for (const slotDef of getLpcCatalog().slots) {
    for (let vIdx = 0; vIdx < slotDef.variants.length; vIdx++) {
      const variant = slotDef.variants[vIdx];
      if (variant) {
        lookup.set(variant.assetId, { slot: slotDef.slot, variantIndex: vIdx });
      }
    }
  }
  return lookup;
};

const _assetLookup = _buildAssetLookup();

/** Required slots that should be present for a complete character. */
const REQUIRED_SLOTS = ['head', 'body', 'torso'];

// ── Implementation ───────────────────────────────────────────────────────

class LpcAiTestViewModel
  extends BaseViewModel<LpcAiTestViewModelOptions>
  implements LpcAiTestViewModelInterface
{
  rawJson = $state('');
  parsedRecipe = $state<Record<string, string> | null>(null);
  diagnostics = $state<SlotDiagnostic[]>([]);
  parseError = $state<string | null>(null);
  recipes = $state<readonly LpcLayerRecipe[]>([]);

  get configuredCount(): number {
    return this.diagnostics.filter((d) => d.status === 'configured').length;
  }

  get missingCount(): number {
    return this.diagnostics.filter(
      (d) => d.status === 'missing_asset' || d.status === 'missing_slot',
    ).length;
  }

  get hasRecipes(): boolean {
    return this.recipes.length > 0;
  }

  // ── Parsing ────────────────────────────────────────────────────────

  parseRecipe(): void {
    this.parseError = null;
    this.parsedRecipe = null;
    this.diagnostics = [];
    this.recipes = [];

    const trimmed = this.rawJson.trim();
    if (!trimmed) {
      this.parseError = 'Paste an LPC recipe JSON object first.';
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.parseError = `Invalid JSON: ${message}`;
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.parseError = 'Expected a JSON object mapping slot names to asset IDs.';
      return;
    }

    const recipe = parsed as Record<string, unknown>;
    const result: Record<string, string> = {};
    const diags: SlotDiagnostic[] = [];

    for (const [slotName, value] of Object.entries(recipe)) {
      if (typeof value !== 'string' || !value.trim()) {
        diags.push({
          slot: slotName,
          status: 'missing_asset',
          assetId: undefined,
          message: 'Empty or non-string asset ID',
        });
        continue;
      }

      const assetId = value.trim();
      const entry = _assetLookup.get(assetId);

      if (entry) {
        result[slotName] = assetId;
        diags.push({
          slot: slotName,
          status: 'configured',
          assetId,
          message: `OK — variant #${entry.variantIndex} in slot "${entry.slot}"`,
        });
      } else {
        diags.push({
          slot: slotName,
          status: 'missing_asset',
          assetId,
          message: `Asset ID not found in catalog — no webp files exist for "${assetId}"`,
        });
      }
    }

    // Check for missing required slots
    for (const required of REQUIRED_SLOTS) {
      if (!(required in result)) {
        diags.push({
          slot: required,
          status: 'missing_slot',
          assetId: undefined,
          message: `Required slot "${required}" is not configured. Character may render incomplete.`,
        });
      }
    }

    this.parsedRecipe = result;
    this.diagnostics = diags;
    this._buildRecipes();
  }

  loadSample(): void {
    const sample: Record<string, string> = {
      head: 'head/heads/human_male',
      body: 'body/bodies_male',
      hair: 'hair/bangs_adult',
      torso: 'torso/clothes/longsleeve/longsleeve_male',
      legs: 'legs/pants_male',
      feet: 'feet/shoes/basic_male',
    };
    this.rawJson = JSON.stringify(sample, null, 2);
    this.parseRecipe();
  }

  clear(): void {
    this.rawJson = '';
    this.parsedRecipe = null;
    this.diagnostics = [];
    this.parseError = null;
    this.recipes = [];
  }

  // ── Private ────────────────────────────────────────────────────────

  private _buildRecipes(): void {
    if (!this.parsedRecipe) {
      this.recipes = [];
      return;
    }

    const buildRecipes: LpcLayerRecipe[] = [];

    for (const [slot, assetId] of Object.entries(this.parsedRecipe)) {
      const entry = _assetLookup.get(assetId);
      if (!entry) {
        continue; // Skip unknown assets — diagnostics already recorded
      }

      buildRecipes.push({
        slot,
        assetId,
        hexPalette: new Uint8Array(1024), // No tint — use raw colors
      });
    }

    this.recipes = buildRecipes;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

export const getLpcAiTestViewModel = (
  options: LpcAiTestViewModelOptions,
): LpcAiTestViewModelInterface => LpcAiTestViewModel.create(options);
