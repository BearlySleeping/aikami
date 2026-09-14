// apps/backend/local-stack/stack/generation/model_sets.ts
//
// C-521: resolve a provider profile's pinned model set from the stack manifest.
//
// Before this, the audio dispatch hardcoded the v1 checkpoint path
// (`/models/audio/ace-step-v1-3.5b`) and the v1 output directory, so a profile
// declaring a different model or a different protocol was silently served by
// v1 artifacts. The manifest — `stack/models.manifest.json` — is the single
// declaration of what is installed and where, so the checkpoint is *derived*
// from the profile's `modelId` here.
//
// A profile whose model set is not pinned in the manifest resolves to
// `installed: false`. That is a structured blocker for the plan/runner, never a
// fallback to whatever happens to be on disk.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { dirname } from 'node:path';
import type { GenerationProviderProfile } from '@aikami/constants';
import type { ModelManifest, ModelManifestEntry } from '@aikami/types';

/** The container mount the manifest's `targetPath` values are relative to. */
export const DEFAULT_MODELS_CONTAINER_ROOT = '/models';

/** Where a v1.5 engine writes the artifacts it returns references to. */
export const DEFAULT_ACE_STEP_V15_ARTIFACT_ROOT = '/models/audio/v15/output';

/**
 * The manifest-relative directory that holds a v1.5 engine's output.
 *
 * Relative rather than absolute so the host can also read it through the
 * models volume it mounts (`MODELS_PATH`).
 */
export const ACE_STEP_V15_ARTIFACT_DIR_RELATIVE = 'audio/v15/output';

/** A profile's model set, resolved against the manifest. */
export type AudioModelSetResolution =
  | {
      installed: true;
      modelId: string;
      /** The primary checkpoint's container directory (the engine's cwd anchor). */
      checkpointPath: string;
      /** The manifest entry the checkpoint came from. */
      entry: ModelManifestEntry;
    }
  | {
      installed: false;
      modelId: string;
      /** Why the set could not be resolved — shown verbatim in a blocker. */
      reason: string;
    };

/** Finds the manifest entry a profile's `modelId` names. */
export const findManifestEntry = (
  manifest: ModelManifest,
  modelId: string,
): ModelManifestEntry | undefined => manifest.entries.find((entry) => entry.id === modelId);

/**
 * The directory every entry of a model set shares.
 *
 * A set's entries live in *component* directories under one root
 * (`audio/ace-step-v1-3.5b/ace_step_transformer/…`, `…/umt5-base/…`), and the
 * engine's `checkpoint_path` is that root — so it is derived from the manifest
 * rather than hardcoded. The companions are what make the derivation work: the
 * primary entry alone would resolve to its component directory.
 *
 * @returns The shared container directory, or `undefined` when the set's
 *          entries do not share one (a manifest that is internally inconsistent).
 */
const sharedContainerDir = (options: {
  manifest: ModelManifest;
  entry: ModelManifestEntry;
  containerRoot: string;
}): string | undefined => {
  const ids = new Set<string>([
    options.entry.id,
    ...(options.entry.companions ?? []).map((companion) => companion.id),
  ]);
  const directories = options.manifest.entries
    .filter((candidate) => ids.has(candidate.id))
    .map((candidate) =>
      dirname(candidate.targetPath)
        .split('/')
        .filter((part) => part.length > 0),
    );
  if (directories.length === 0) {
    return undefined;
  }
  const [first, ...rest] = directories as [string[], ...string[][]];
  const shared: string[] = [];
  for (const [index, part] of first.entries()) {
    if (!rest.every((directory) => directory[index] === part)) {
      break;
    }
    shared.push(part);
  }
  if (shared.length === 0) {
    return undefined;
  }
  return `${options.containerRoot}/${shared.join('/')}`;
};

/**
 * Resolves the checkpoint directory a profile dispatches to.
 *
 * For the v1 set this resolves to `/models/audio/ace-step-v1-3.5b` — the same
 * path the CLI used to hardcode — but now because the manifest's entries say
 * so. A profile whose set pins a different root gets that root.
 */
export const resolveAudioModelSet = (options: {
  profile: GenerationProviderProfile;
  /** The parsed `models.manifest.json`. */
  manifest: ModelManifest;
  /** Container mount for `targetPath` (defaults to `/models`). */
  containerRoot?: string;
}): AudioModelSetResolution => {
  const { profile, manifest } = options;
  const containerRoot = options.containerRoot ?? DEFAULT_MODELS_CONTAINER_ROOT;
  const modelId = profile.modelId;
  if (modelId === undefined || modelId.length === 0) {
    return {
      installed: false,
      modelId: profile.id,
      reason: `Provider profile "${profile.id}" declares no modelId, so no pinned model set can be resolved for engine "${profile.engineId ?? 'unknown'}".`,
    };
  }
  const entry = findManifestEntry(manifest, modelId);
  if (entry === undefined) {
    return {
      installed: false,
      modelId,
      reason: `Model set "${modelId}" (declared by provider profile "${profile.id}") is not pinned in stack/models.manifest.json — it is not installed, and the runner will not fall back to a different checkpoint.`,
    };
  }
  const checkpointPath = sharedContainerDir({ manifest, entry, containerRoot });
  if (checkpointPath === undefined) {
    return {
      installed: false,
      modelId,
      reason: `The manifest entries for model set "${modelId}" do not share a container directory, so the engine's checkpoint path cannot be derived.`,
    };
  }
  return { installed: true, modelId, checkpointPath, entry };
};
