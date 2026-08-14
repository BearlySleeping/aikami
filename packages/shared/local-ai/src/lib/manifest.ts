// packages/shared/local-ai/src/lib/manifest.ts
//
// Loads and validates C-390's models.manifest.json. Pure: accepts a JSON
// string or reads through the injected ProbeExecutor seam (never node:fs).
// The manifest is C-390's — this contract only reads it.

import { ModelManifestSchema } from '@aikami/schemas';
import type { ModelManifest } from '@aikami/types';
import { Value } from 'typebox/value';
import type { ProbeExecutor, ProbeResult } from './probe_executor.ts';

/**
 * Parses and validates raw manifest JSON.
 *
 * @param raw — Raw JSON text of models.manifest.json.
 * @returns The validated manifest.
 * @throws Error when the JSON is invalid or does not match the manifest schema.
 */
export const parseManifest = (raw: string): ModelManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `invalid manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const checked = Value.Check(ModelManifestSchema, parsed);
  if (!checked) {
    throw new Error('manifest does not match the C-390 models.manifest.json schema');
  }
  return parsed as ModelManifest;
};

/**
 * Loads the manifest through a ProbeExecutor's readTextFile seam. The
 * adapter owns the actual filesystem; the core stays portable.
 *
 * @param options — executor and the manifest path.
 */
export const loadManifest = async (options: {
  readonly executor: ProbeExecutor;
  readonly path: string;
}): Promise<ModelManifest> => {
  const result: ProbeResult = await options.executor.readTextFile(options.path);
  if (!result.ok) {
    throw new Error(`manifest read failed (${result.reason}): ${options.path}`);
  }
  return parseManifest(result.stdout);
};
