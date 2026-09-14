// apps/backend/image/scripts/generate_batch_engines.ts
/** biome-ignore-all lint/style/useNamingConvention: the brief schema uses snake_case keys verbatim */
//
// C-521: the batch CLI's engine factory.
//
// Extracted from `generate_batch.ts` because it is where the *profile* decides
// the adapter and the artifacts:
//
//   * `protocol` selects the ACE-Step adapter, so a `ace-step-v1.5` profile is
//     never served by the v1 `/generate` API;
//   * `modelId` is resolved against `stack/models.manifest.json`, so the
//     checkpoint is the pinned one rather than a hardcoded v1 path;
//   * an unresolvable protocol or model set returns `undefined`, which the
//     runner turns into a structured blocker — never a fallback checkpoint.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import {
  ACE_STEP_V15_OUTPUT_FORMATS,
  createGenerationEngine,
  isAceStepProtocol,
} from '@aikami/local-ai';
import {
  ACE_STEP_V15_ARTIFACT_DIR_RELATIVE,
  type BatchEngineFactory,
  DEFAULT_ACE_STEP_V15_ARTIFACT_ROOT,
  resolveAudioModelSet,
} from '@aikami/local-stack/generation';
import { ModelManifestSchema } from '@aikami/schemas';
import type { ModelManifest } from '@aikami/types';
import { Value } from 'typebox/value';

/** Default audio engine endpoint — the local-stack `audio` compose profile. */
const DEFAULT_ACE_STEP_SERVER = 'http://127.0.0.1:8001';

/** Default image engine endpoint — the local-stack `image` compose profile. */
const DEFAULT_SD_SERVER = 'http://127.0.0.1:8188';

/** Poll deadline default (seconds) for an image job. */
const DEFAULT_TIMEOUT_SECONDS = 900;

/** Poll deadline default (seconds) for an audio job. */
const DEFAULT_AUDIO_TIMEOUT_SECONDS = 1800;

export const DEFAULT_ENGINE_SERVERS = {
  image: DEFAULT_SD_SERVER,
  audio: DEFAULT_ACE_STEP_SERVER,
} as const;

export const DEFAULT_ENGINE_TIMEOUTS = {
  image: DEFAULT_TIMEOUT_SECONDS,
  audio: DEFAULT_AUDIO_TIMEOUT_SECONDS,
} as const;

/**
 * Where the stack manifest lives, relative to the repository root.
 *
 * The manifest is the declaration of what is installed and where; the audio
 * engine factory derives each profile's checkpoint from it (C-521), so a
 * profile whose model set is not pinned is a blocker rather than a silent v1
 * fallback.
 */
const MODELS_MANIFEST_RELATIVE = 'apps/backend/local-stack/stack/models.manifest.json';

/**
 * The stack's pinned model manifest, read once per process.
 *
 * `undefined` means the manifest could not be read, which makes every audio
 * profile unresolvable — a blocker, never a guessed checkpoint.
 */
export const loadModelsManifest = (repoRoot: string): ModelManifest | undefined => {
  const path = join(repoRoot, MODELS_MANIFEST_RELATIVE);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return Value.Check(ModelManifestSchema, parsed) ? (parsed as ModelManifest) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The engine factory used by real runs.
 *
 * C-521: the *profile* decides the adapter and the artifacts. The factory
 * resolves the profile's `protocol` (so a v1.5 profile gets the versioned
 * adapter, never the v1 one) and its `modelId` against the stack manifest (so
 * the checkpoint is the pinned one, not the v1 path). When either cannot be
 * resolved the factory returns `undefined`, which the runner turns into a
 * structured blocker — it never falls back to a different checkpoint or API.
 */
export const buildEngineFactory =
  (options: {
    engineUrl?: string;
    timeoutSeconds?: number;
    repoRoot?: string;
  }): BatchEngineFactory =>
  ({ item, engineId }) => {
    const timeoutSeconds =
      options.timeoutSeconds ??
      (engineId === 'ace-step' ? DEFAULT_AUDIO_TIMEOUT_SECONDS : DEFAULT_TIMEOUT_SECONDS);
    const baseUrl =
      options.engineUrl ?? (engineId === 'ace-step' ? DEFAULT_ACE_STEP_SERVER : DEFAULT_SD_SERVER);
    if (engineId !== 'ace-step') {
      return createGenerationEngine(engineId, { baseUrl, queueWaitMs: timeoutSeconds * 1000 });
    }

    const profile = GENERATION_PROVIDER_PROFILES[item.providerProfileId];
    if (profile === undefined) {
      return undefined;
    }
    const repoRoot = options.repoRoot ?? findRepoRoot(process.cwd());
    const manifest = loadModelsManifest(repoRoot);
    if (manifest === undefined) {
      return undefined;
    }
    const modelSet = resolveAudioModelSet({ profile, manifest });
    if (!modelSet.installed) {
      // The profile names a model set that is not pinned here. Dispatch is
      // refused rather than served by whatever checkpoint is on disk.
      return undefined;
    }

    const modelsPath = process.env.MODELS_PATH?.trim();
    // The engine writes its artifacts inside its own container; the host reads
    // them back through the mounted models volume. Without it there is no
    // bounded way to retrieve either protocol's output.
    const readArtifactFrom = async (
      relativeDir: string,
      enginePath: string,
    ): Promise<Uint8Array> => {
      if (!modelsPath) {
        throw new Error(
          `Job "${item.itemId}" resolves to the ACE-Step engine; set MODELS_PATH so the CLI can read the artifact the engine writes on its own filesystem.`,
        );
      }
      const name = enginePath.split('/').at(-1) ?? '';
      return new Uint8Array(readFileSync(join(modelsPath, relativeDir, name)));
    };

    if (isAceStepProtocol(profile.protocol) && profile.protocol === 'ace-step-v1.5') {
      return createGenerationEngine(engineId, {
        baseUrl,
        queueWaitMs: timeoutSeconds * 1000,
        aceStepProtocol: profile.protocol,
        aceStepV15: {
          modelId: modelSet.modelId,
          outputFormat: ACE_STEP_V15_OUTPUT_FORMATS[0],
          allowedArtifactRoots: [DEFAULT_ACE_STEP_V15_ARTIFACT_ROOT],
          fetchArtifact: (reference) =>
            readArtifactFrom(ACE_STEP_V15_ARTIFACT_DIR_RELATIVE, reference.reference),
        },
      });
    }

    return createGenerationEngine(engineId, {
      baseUrl,
      queueWaitMs: timeoutSeconds * 1000,
      aceStepProtocol: 'ace-step-v1',
      aceStep: {
        modelId: modelSet.modelId,
        checkpointPath: modelSet.checkpointPath,
        readArtifact: (enginePath: string) => readArtifactFrom('audio/output', enginePath),
      },
    });
  };
