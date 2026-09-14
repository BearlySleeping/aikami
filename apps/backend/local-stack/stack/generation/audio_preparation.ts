// apps/backend/local-stack/stack/generation/audio_preparation.ts
//
// C-521: the runner's audio seams, kept out of `runner.ts` so the durable-job
// loop stays readable (and inside the source-size ceiling).
//
// Two seams live here:
//
//   * **Ingest** — an owned/licensed recording is read from a bounded locator.
//     A refused ingest is a typed result, never an exception: the runner turns
//     it into a job failure whose code says which bound was broken.
//   * **Finishing** — master bytes become a rendition set (archival master plus
//     the brief profile's runtime rendition) through the same host finisher a
//     generated candidate uses. Nothing here distinguishes the two sources.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { join, resolve } from 'node:path';
import { DEFAULT_AUDIO_IMPORT_ROOT, readAudioImport, resolveAudioImport } from './audio_import.ts';
import { finishAudioCandidate, type FinishedAudioCandidate } from './audio_finishing.ts';
import type { AudioRendition } from '@aikami/types';

/**
 * The root an import locator must stay inside.
 *
 * Resolved from the repository root so a locator written relative to the repo
 * (as the brief's own paths are) resolves, while an absolute path outside it is
 * still refused.
 */
export const defaultAudioImportRoot = (): string =>
  resolve(import.meta.dir, '../../../../..', DEFAULT_AUDIO_IMPORT_ROOT);

/** An audio master read from its declared import locator. */
export type ImportedMaster =
  | { ok: true; bytes: Uint8Array; extension: string }
  | { ok: false; code: string; message: string };

/**
 * Reads the master bytes an import-mode item declares.
 *
 * @param options.locator - The brief's `importLocator`.
 * @param options.importRoot - The bounded root it must resolve inside.
 */
export const readImportedMaster = async (options: {
  locator: string;
  importRoot: string;
}): Promise<ImportedMaster> => {
  const resolved = resolveAudioImport({
    locator: options.locator,
    importRoot: options.importRoot,
  });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, message: resolved.message };
  }
  return { ok: true, bytes: await readAudioImport(resolved), extension: resolved.extension };
};

/** The audio finisher, as the runner injects it (tests stub it). */
export type AudioCandidateFinisher = (options: {
  masterBytes: Uint8Array;
  preparationProfile: string;
  scratchDir: string;
  slug: string;
  createdAt: string;
}) => Promise<FinishedAudioCandidate>;

/** The real finisher: ffmpeg → decoded-PCM measurement → rendition record. */
export const defaultAudioFinisher: AudioCandidateFinisher = (options) =>
  finishAudioCandidate(options);

/** The outcome of preparing one audio candidate. */
export type AudioPreparationOutcome =
  | { ok: true; renditions: readonly AudioRendition[] }
  | { ok: false; code: string; message: string };

/**
 * Finishes a candidate's master into its brief profile's rendition set.
 *
 * @param options.runDir - The run's own directory; scratch files stay inside it
 *        so a run never writes outside its own tree.
 */
export const prepareAudioCandidate = async (options: {
  masterBytes: Uint8Array;
  preparationProfile: string;
  runDir: string;
  slug: string;
  createdAt: string;
  finisher?: AudioCandidateFinisher;
}): Promise<AudioPreparationOutcome> => {
  const finisher = options.finisher ?? defaultAudioFinisher;
  const finished = await finisher({
    masterBytes: options.masterBytes,
    preparationProfile: options.preparationProfile,
    scratchDir: join(options.runDir, 'audio'),
    slug: options.slug,
    createdAt: options.createdAt,
  });
  if (finished.accepted) {
    return { ok: true, renditions: finished.renditions };
  }
  const codes = finished.findings
    .filter((entry) => entry.severity === 'error')
    .map((entry) => entry.code)
    .join(', ');
  return {
    ok: false,
    code: finished.refusal?.code ?? 'master_rejected',
    message:
      finished.refusal?.message ??
      `audio preparation rejected the master (${codes.length > 0 ? codes : 'no error code'})`,
  };
};
