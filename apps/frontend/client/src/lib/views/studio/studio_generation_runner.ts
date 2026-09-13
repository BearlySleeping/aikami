// apps/frontend/client/src/lib/views/studio/studio_generation_runner.ts
//
// C-513 AC-12 — the modality-neutral studio generation runner.
//
// C-512 hard-coded `modality === 'image'` in `studio_composition.ts`: the only
// engine the client had was the image path, so an audio recipe was listed and
// then silently unavailable. This module replaces the hard check with a
// registry keyed by `recipe.modality`:
//
//   * capability gating — an audio recipe becomes available the moment an
//     audio engine adapter is registered (C-521 supplies the real one), and
//     while none is registered the recipe carries a *stated reason* instead of
//     a bare disabled control;
//   * dispatch — every generate/save goes through the shared runner, which
//     resolves the workflow for the recipe's modality. The view model never
//     switches on modality.
//
// Contract: C-513 AC-12

import { listRecipes, requireRecipe } from '@aikami/local-ai';
import type {
  AssetRecipe,
  GenerationEngineId,
  GenerationModality,
  StudioRecipeOption,
} from '@aikami/types';
import type { GeneratedAssetOutcome, GeneratedAssetSaveOutcome } from '$types';

/** One generation request, modality-neutral. */
export type StudioEngineGenerateOptions = {
  /** The recipe being generated — its modality selects the engine. */
  recipeId: string;
  prompt: string;
  negativePrompt?: string;
  /** Set for NPC-bound assets — drives the `expressionAssetTag` override. */
  npcId?: string;
  /** Emotion for an NPC-bound asset. */
  emotion?: string;
  /** Reference face (data URL) for a consistent expression pack. */
  initImage?: string;
  /** Extra reference images (character consistency). */
  referenceImages?: readonly string[];
  signal?: AbortSignal;
};

/** Raw engine output, before any registry involvement. */
export type StudioEngineResult = {
  blob: Blob;
  mimeType: string;
  engineId: GenerationEngineId;
  seed?: number;
  isDemo: boolean;
};

/**
 * One registered generation engine, keyed by the modality it produces.
 *
 * C-521 registers the audio adapter; the composition registers the image one.
 */
export type StudioEngineCapability = {
  modality: GenerationModality;
  /**
   * Probe the engine. Resolves false when nothing is reachable — never throws,
   * so a dead engine degrades to "unavailable with a reason".
   */
  isAvailable(): Promise<boolean>;
  /** User-facing reason shown while this modality is unavailable. */
  unavailableReason: string;
  /** Generates bytes. Only called once `isAvailable()` resolved true. */
  generate(options: StudioEngineGenerateOptions): Promise<StudioEngineResult>;
  /** Aborts the in-flight generation, if any. */
  cancel(): void;
};

/** The modality → engine map the studio resolves against. */
export type StudioEngineRegistry = {
  register(adapter: StudioEngineCapability): void;
  get(modality: GenerationModality): StudioEngineCapability | undefined;
  /** Every modality with an adapter registered. */
  modalities(): readonly GenerationModality[];
};

/** Builds a registry from an initial adapter list. */
export const createStudioEngineRegistry = (
  adapters: readonly StudioEngineCapability[] = [],
): StudioEngineRegistry => {
  const byModality = new Map<GenerationModality, StudioEngineCapability>();
  for (const adapter of adapters) {
    byModality.set(adapter.modality, adapter);
  }
  return {
    register: (adapter: StudioEngineCapability): void => {
      byModality.set(adapter.modality, adapter);
    },
    get: (modality: GenerationModality): StudioEngineCapability | undefined =>
      byModality.get(modality),
    modalities: (): readonly GenerationModality[] => [...byModality.keys()],
  };
};

/** The default reason when no adapter is registered for a modality at all. */
export const noEngineRegisteredReason = (modality: GenerationModality): string =>
  `No ${modality} generation engine is registered for this session.`;

/**
 * Recipe options with availability resolved per `recipe.modality`.
 *
 * A recipe whose modality has no adapter — or whose adapter is unreachable —
 * carries `unavailableReason`, so the studio can state *why* instead of just
 * disabling the control.
 */
export const buildModalityRecipeOptions = async (options: {
  registry: StudioEngineRegistry;
  label: (recipeId: string) => string;
  /** Override the recipe list (tests). Defaults to the shared registry. */
  recipes?: readonly AssetRecipe[];
}): Promise<readonly StudioRecipeOption[]> => {
  const recipes = options.recipes ?? listRecipes();
  const availability = new Map<GenerationModality, boolean>();

  for (const recipe of recipes) {
    if (availability.has(recipe.modality)) {
      continue;
    }
    const adapter = options.registry.get(recipe.modality);
    availability.set(recipe.modality, adapter ? await adapter.isAvailable() : false);
  }

  return recipes.map((recipe) => {
    const adapter = options.registry.get(recipe.modality);
    const available = availability.get(recipe.modality) === true;
    return {
      recipeId: recipe.id,
      label: options.label(recipe.id),
      category: recipe.category,
      modality: recipe.modality,
      engineAvailable: available,
      ...(available
        ? {}
        : {
            unavailableReason:
              adapter?.unavailableReason ?? noEngineRegisteredReason(recipe.modality),
          }),
    };
  });
};

/** The per-modality workflow the runner dispatches to (C-512's byte seam). */
export type StudioGenerationWorkflow = {
  generate(options: StudioEngineGenerateOptions): Promise<GeneratedAssetOutcome>;
  save(options: { tag: string }): Promise<GeneratedAssetSaveOutcome>;
  discard(tag: string): void;
  dispose(): void;
};

/** Dependencies for {@link createStudioGenerationRunner}. */
export type StudioGenerationRunnerDeps = {
  registry: StudioEngineRegistry;
  /** Builds the byte seam for one modality's adapter. */
  createWorkflow(adapter: StudioEngineCapability): StudioGenerationWorkflow;
  /** Recipe lookup (tests may override). */
  resolveRecipe?: (recipeId: string) => AssetRecipe;
};

/**
 * The shared, modality-neutral entry point for studio generation.
 *
 * One workflow per modality, created lazily on first use, so an idle modality
 * costs nothing. Pending bytes are tracked by tag across workflows — `save`
 * therefore never has to guess which modality produced them.
 */
export const createStudioGenerationRunner = (deps: StudioGenerationRunnerDeps) => {
  const workflows = new Map<GenerationModality, StudioGenerationWorkflow>();
  const tagOwner = new Map<string, StudioGenerationWorkflow>();
  const resolveRecipe = deps.resolveRecipe ?? requireRecipe;

  const workflowFor = (modality: GenerationModality): StudioGenerationWorkflow => {
    const existing = workflows.get(modality);
    if (existing) {
      return existing;
    }
    const adapter = deps.registry.get(modality);
    if (!adapter) {
      throw new Error(noEngineRegisteredReason(modality));
    }
    const workflow = deps.createWorkflow(adapter);
    workflows.set(modality, workflow);
    return workflow;
  };

  return {
    /** Dispatches by the recipe's modality — never by a hard-coded switch. */
    generate: async (options: StudioEngineGenerateOptions): Promise<GeneratedAssetOutcome> => {
      const workflow = workflowFor(resolveRecipe(options.recipeId).modality);
      const outcome = await workflow.generate(options);
      tagOwner.set(outcome.tag, workflow);
      return outcome;
    },

    /** Saves the pending bytes for a tag, whichever modality produced them. */
    save: async (options: { tag: string }): Promise<GeneratedAssetSaveOutcome> => {
      const workflow = tagOwner.get(options.tag);
      if (!workflow) {
        throw new Error(
          `No generated bytes are pending for "${options.tag}" — generate before saving`,
        );
      }
      return workflow.save(options);
    },

    /** Cancels every modality's in-flight generation. */
    cancel: (): void => {
      for (const adapter of deps.registry.modalities()) {
        deps.registry.get(adapter)?.cancel();
      }
    },

    /** Drops a pending result (preview URL + bytes). */
    discard: (tag: string): void => {
      const workflow = tagOwner.get(tag);
      workflow?.discard(tag);
      tagOwner.delete(tag);
    },

    /** Drops every pending result. */
    dispose: (): void => {
      for (const workflow of workflows.values()) {
        workflow.dispose();
      }
      workflows.clear();
      tagOwner.clear();
    },
  };
};

/** The runner surface the composition hands to the view model. */
export type StudioGenerationRunner = ReturnType<typeof createStudioGenerationRunner>;
