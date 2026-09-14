// apps/backend/image/scripts/generate_batch_engines.ts
//
// C-519/C-520: how the batch CLI constructs engines.
//
// Endpoint resolution, poll deadlines, the ACE-Step artifact mount and the
// C-520 pinned workflow profile all meet in one place. Kept out of the
// orchestrator so the CLI's dispatch loop stays a dispatcher, and so the
// "which engine, which graph" decision is testable on its own.
//
// Contract: C-519 Durable asset jobs and batch execution

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGenerationEngine } from '@aikami/local-ai';
import type { BatchEngineFactory } from '@aikami/local-stack/generation';

/** Default image engine endpoint — the local-stack `image` compose profile. */
export const DEFAULT_SD_SERVER = 'http://127.0.0.1:8188';

/** Default audio engine endpoint — the local-stack `audio` compose profile. */
export const DEFAULT_ACE_STEP_SERVER = 'http://127.0.0.1:8001';

/** Checkpoint directory as seen by the ACE-Step container. */
export const DEFAULT_ACE_STEP_CHECKPOINT = '/models/audio/ace-step-v1-3.5b';

/** Output directory as seen by the ACE-Step container. */
export const DEFAULT_ACE_STEP_OUTPUT_DIR = '/models/audio/output';

/** Poll deadline default (seconds) for an image job. */
export const DEFAULT_TIMEOUT_SECONDS = 900;

/** Poll deadline default (seconds) for an audio job. */
export const DEFAULT_AUDIO_TIMEOUT_SECONDS = 1800;

export const buildEngineFactory =
  (options: {
    engineUrl?: string;
    timeoutSeconds?: number;
    /** C-520: pinned ComfyUI workflow profile, when one was selected. */
    workflowProfileId?: string;
  }): BatchEngineFactory =>
  ({ item, engineId }) => {
    const timeoutSeconds =
      options.timeoutSeconds ??
      (engineId === 'ace-step' ? DEFAULT_AUDIO_TIMEOUT_SECONDS : DEFAULT_TIMEOUT_SECONDS);
    const baseUrl =
      options.engineUrl ?? (engineId === 'ace-step' ? DEFAULT_ACE_STEP_SERVER : DEFAULT_SD_SERVER);
    if (engineId === 'ace-step') {
      const modelsPath = process.env.MODELS_PATH?.trim();
      if (!modelsPath) {
        throw new Error(
          `Job "${item.itemId}" resolves to the ACE-Step engine; set MODELS_PATH (or use an image provider) so the CLI can read the artifact the engine writes on its own filesystem.`,
        );
      }
      return createGenerationEngine(engineId, {
        baseUrl,
        queueWaitMs: timeoutSeconds * 1000,
        aceStep: {
          checkpointPath: DEFAULT_ACE_STEP_CHECKPOINT,
          outputDir: DEFAULT_ACE_STEP_OUTPUT_DIR,
          readArtifact: async (enginePath: string) =>
            new Uint8Array(
              readFileSync(join(modelsPath, 'audio/output', enginePath.split('/').at(-1) ?? '')),
            ),
        },
      });
    }
    if (options.workflowProfileId !== undefined && engineId !== 'comfyui') {
      throw new Error(
        `Job "${item.itemId}" resolves to the "${engineId}" engine, which has no workflow-profile support — --workflow-profile selects a pinned ComfyUI graph, so the run is refused rather than silently using the default graph`,
      );
    }
    return createGenerationEngine(engineId, {
      baseUrl,
      queueWaitMs: timeoutSeconds * 1000,
      ...(options.workflowProfileId === undefined
        ? {}
        : { workflowProfileId: options.workflowProfileId }),
    });
  };
