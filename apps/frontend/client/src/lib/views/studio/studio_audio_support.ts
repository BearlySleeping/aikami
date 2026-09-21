// apps/frontend/client/src/lib/views/studio/studio_audio_support.ts
//
// C-521 — pure derivations the Studio ViewModel needs for its audio path.
//
// Extracted so the ViewModel stays a thin state machine: these functions take
// values and return values, hold no state, and are unit-testable without a
// ViewModel or a browser.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { expressionAssetTag, STUDIO_EXPRESSION_PACK_EMOTIONS } from '@aikami/constants';
import type { LibraryEntry, StudioDraft, StudioRecipeOption } from '@aikami/types';
import type { GeneratedAssetOutcome, StudioLibraryRow, StudioPackRow } from '$types';

/** Whether a recipe produces audio. Undefined (no recipe picked) is not audio. */
export const isAudioRecipe = (recipe: StudioRecipeOption | undefined): boolean =>
  recipe?.modality === 'audio';

/**
 * The exact reason new audio generation is refused, or `undefined` when it is
 * allowed. The flag disables *generation* only — nothing about playback.
 */
export const audioGenerationRefusal = (options: {
  recipe: StudioRecipeOption | undefined;
  generationEnabled: boolean;
}): string | undefined => {
  if (!isAudioRecipe(options.recipe) || options.generationEnabled) {
    return undefined;
  }
  return 'New audio generation is disabled (PUBLIC_AUDIO_GENERATION is off). Saved and accepted audio still plays.';
};

/** The review panel's tag/ext/engine summary, or '' with no candidate. */
export const describeAudioCandidateLabel = (
  generated: GeneratedAssetOutcome | undefined,
): string =>
  generated === undefined ? '' : `${generated.tag} · ${generated.ext} · ${generated.engine}`;

/** The expression-pack rows for the current NPC draft. */
export const buildPackRows = (options: {
  npcId: string;
  packStatus: Readonly<Record<string, string>>;
}): readonly StudioPackRow[] => {
  const npcId = options.npcId.trim();
  return STUDIO_EXPRESSION_PACK_EMOTIONS.map((emotion) => ({
    emotion: emotion.id,
    tag: npcId.length > 0 ? expressionAssetTag({ npcId, emotion: emotion.id }) : '',
    status: options.packStatus[emotion.id] ?? 'Pending',
  }));
};

/**
 * Builds the persisted draft shape.
 *
 * Optional keys are omitted rather than set to `''`, because the stored draft is
 * re-validated on load and an empty `npcId` would read as "bound to an NPC with
 * an empty id".
 */
export const buildStudioDraft = (options: {
  id: string;
  recipeId: string;
  npcId: string;
  positivePrompt: string;
  negativePrompt: string;
  initImageTag: string;
  generated: GeneratedAssetOutcome | undefined;
  updatedAt: string;
}): StudioDraft => {
  const npcId = options.npcId.trim();
  const generated = options.generated;
  return {
    id: options.id,
    recipeId: options.recipeId,
    ...(npcId.length > 0 ? { npcId } : {}),
    positivePrompt: options.positivePrompt,
    ...(options.negativePrompt.length > 0 ? { negativePrompt: options.negativePrompt } : {}),
    ...(options.initImageTag.length > 0 ? { initImageTag: options.initImageTag } : {}),
    ...(generated === undefined
      ? {}
      : {
          generated: {
            tag: generated.tag,
            sha256: generated.sha256,
            engine: generated.engine,
            ...(generated.seed === undefined ? {} : { seed: generated.seed }),
          },
        }),
    updatedAt: options.updatedAt,
  };
};

/** Maps registry rows to the library table's display rows. */
export const buildLibraryRows = (options: {
  library: readonly LibraryEntry[];
  formatBytes: (bytes: number) => string;
}): readonly StudioLibraryRow[] =>
  options.library.map((entry) => ({
    tag: entry.tag,
    category: entry.category,
    provenanceLabel: entry.provenance.source,
    sizeLabel: options.formatBytes(entry.sizeBytes),
    ext: entry.ext,
    createdAtLabel: entry.createdAt.length > 0 ? entry.createdAt : 'unknown',
  }));
