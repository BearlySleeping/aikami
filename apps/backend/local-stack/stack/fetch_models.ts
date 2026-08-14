/**
 * apps/backend/local-stack/stack/fetch_models.ts
 *
 * Checksum-verified, resumable, profile-scoped model fetcher for the local
 * stack (C-390 AC-6/AC-7). Runs as the one-shot `model-fetcher` compose
 * service: it populates the shared `aikami-models` named volume (or the
 * MODELS_PATH bind mount) before the engines start.
 *
 * Behaviour contract:
 *   - Idempotent: a second full run downloads nothing (completion markers).
 *   - Resumable: an interrupted download leaves a `.part` file that the next
 *     run continues with a Range request instead of restarting.
 *   - Verified: every downloaded artifact is SHA-256 checked against the
 *     pinned digest in models.manifest.json; a corrupt file is re-fetched.
 *   - Profile-scoped: only modalities enabled via COMPOSE_PROFILES are
 *     fetched (text → text, image → image, voice → tts, stt → stt).
 *   - STT tier-scoped (C-393): the stt profile fetches exactly the selected
 *     streaming + batch models plus the Silero VAD entry, gated by the
 *     STT_STREAM_MODEL / STT_BATCH_MODEL envs (default: minimal tier).
 *     An explicit --entry request bypasses the tier filter.
 *   - Non-fatal: a failed download for one modality does not change the exit
 *     status (0) as long as the enabled modalities were attempted, so one
 *     dead mirror cannot prevent unrelated engines from starting.
 *   - Acknowledgement gate: entries with requiresAcknowledgement are skipped
 *     unless the licence is accepted via AIKAMI_ACCEPT_LICENSES; the licence
 *     name and URL are printed and the exit status stays zero.
 *
 * Usage (standalone):
 *   bun stack/fetch_models.ts [--entry <id>] [--models-dir <dir>]
 *
 * Env: COMPOSE_PROFILES, MODELS_PATH, AIKAMI_ACCEPT_LICENSES, AIKAMI_MODELS_DIR
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type Modality = 'text' | 'image' | 'tts' | 'stt';

export type ManifestEntry = {
  id: string;
  modality: Modality;
  tier: string;
  license: string;
  requiresAcknowledgement: boolean;
  kind: 'file' | 'archive';
  /** file kind: HuggingFace repo (repo/revision/file) or direct url override */
  repo?: string;
  revision?: string;
  file?: string;
  /** archive kind: direct download url */
  url?: string;
  targetPath: string;
  bytes: number;
  sha256: string;
};

export type Manifest = {
  schemaVersion: number;
  entries: ManifestEntry[];
};

/** Compose profile → manifest modalities. `web` has no models. */
export const PROFILE_MODALITY: Readonly<Record<string, readonly Modality[]>> = {
  text: ['text'],
  image: ['image'],
  voice: ['tts'],
  stt: ['stt'],
  web: [],
} as const;

export const ALL_MODALITIES: readonly Modality[] = ['text', 'image', 'tts', 'stt'] as const;

// C-393: STT model tiers. The stt profile must NOT download every tier —
// selecting a tier means fetching exactly the VAD model plus the entries
// for the chosen streaming + batch models (Watch Point: “the fetcher
// downloads every entry of a modality”). Values are manifest targetPaths.
export const STT_VAD_ENTRY_ID = 'stt-silero-vad';
export const DEFAULT_STT_STREAM_MODEL = 'stt/sherpa-onnx-moonshine-tiny-en-int8';
export const DEFAULT_STT_BATCH_MODEL = 'stt/whisper-tiny/ggml-tiny.bin';

/**
 * Filters manifest entries to the STT tier selection.
 *
 * The Silero VAD model is mandatory; the streaming and batch entries are
 * matched by targetPath (exact, or a directory prefix for archive entries).
 * When an env is unset the shipped default (minimal tier) is used.
 */
export const selectSttEntries = (options: {
  entries: readonly ManifestEntry[];
  streamModel?: string;
  batchModel?: string;
}): ManifestEntry[] => {
  const { entries } = options;
  // Empty strings (compose interpolation of an unset var) mean "use the
  // shipped default" just like undefined.
  const stream =
    options.streamModel && options.streamModel.length > 0
      ? options.streamModel
      : DEFAULT_STT_STREAM_MODEL;
  const batch =
    options.batchModel && options.batchModel.length > 0
      ? options.batchModel
      : DEFAULT_STT_BATCH_MODEL;
  const matches =
    (value: string): ((entry: ManifestEntry) => boolean) =>
    (entry) =>
      entry.targetPath === value || entry.targetPath.startsWith(`${value}/`);
  const sttEntries = entries.filter((entry) => entry.modality === 'stt');
  const selected = sttEntries.filter(
    (entry) => entry.id === STT_VAD_ENTRY_ID || matches(stream)(entry) || matches(batch)(entry),
  );
  // Warn when a configured selector matches no manifest entry — the fetcher
  // would silently skip the requested model (Watch Point: tier selection).
  if (!sttEntries.some(matches(stream))) {
    // biome-ignore lint/suspicious/noConsole: container log (standalone script)
    console.warn(
      `[fetcher] STT_STREAM_MODEL '${stream}' matches no manifest entry — streaming model will not be fetched`,
    );
  }
  if (!sttEntries.some(matches(batch))) {
    // biome-ignore lint/suspicious/noConsole: container log (standalone script)
    console.warn(
      `[fetcher] STT_BATCH_MODEL '${batch}' matches no manifest entry — batch model will not be fetched`,
    );
  }
  return selected;
};

/**
 * Parses and validates the manifest JSON.
 * @param path — Path to models.manifest.json.
 * @returns The parsed manifest.
 */
export const loadManifest = async (path: string): Promise<Manifest> => {
  const raw = Bun.file(path);
  if (!existsSync(path)) {
    throw new Error(`manifest not found: ${path}`);
  }
  const parsed = JSON.parse(await raw.text()) as Manifest;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`invalid manifest schema: ${path}`);
  }
  for (const entry of parsed.entries) {
    if (!entry.id || !entry.modality || !entry.targetPath || !entry.sha256) {
      throw new Error(`invalid manifest entry: ${JSON.stringify(entry)}`);
    }
    if (entry.kind === 'archive' && !entry.url) {
      throw new Error(`archive entry without url: ${entry.id}`);
    }
    if (entry.kind === 'file' && !entry.url && (!entry.repo || !entry.revision || !entry.file)) {
      throw new Error(`file entry without source: ${entry.id}`);
    }
  }
  return parsed;
};

/**
 * Resolves the download URL for a manifest entry.
 * @param entry — Manifest entry.
 * @returns The URL to download.
 */
export const resolveEntryUrl = (entry: ManifestEntry): string => {
  if (entry.url) {
    return entry.url;
  }
  // file kind from HuggingFace
  return `https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${entry.file}`;
};

/** Completion marker file name (kept next to a downloaded file). */
export const COMPLETE_MARKER = '.aikami-complete';
/** Part-file suffix used while a download is in flight. */
export const PART_SUFFIX = '.part';

/**
 * Computes the SHA-256 of a file in streaming fashion.
 * @param path — File to hash.
 * @returns Hex digest.
 */
export const sha256File = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  const hash = createHash('sha256');
  const reader = file.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    hash.update(value as Uint8Array);
  }
  return hash.digest('hex');
};

/**
 * Downloads a URL to a target path with Range-based resume and SHA-256
 * verification. Writes to `<target>.part` first; on success verifies the
 * digest and atomically renames to `<target>`.
 *
 * @param options — url, target, expectedSha256, expectedBytes, onProgress.
 * @throws Error on network failure or digest mismatch.
 */
export const downloadResumable = async (options: {
  url: string;
  target: string;
  expectedSha256: string;
  expectedBytes?: number;
  onProgress?: (options: { received: number; expected: number }) => void;
}): Promise<void> => {
  const { url, target, expectedSha256 } = options;
  const partPath = `${target}${PART_SUFFIX}`;
  await mkdir(dirname(target), { recursive: true });

  // Start from the current .part size so an interrupted download resumes.
  let offset = 0;
  if (existsSync(partPath)) {
    try {
      offset = (await stat(partPath)).size;
    } catch {
      offset = 0;
    }
  }

  const headers: Record<string, string> = {};
  if (offset > 0) {
    headers.Range = `bytes=${offset}-`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok && response.status !== 206 && !(response.status === 200 && offset === 0)) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  if (response.status === 416) {
    // Server does not support range resume at this offset — restart cleanly.
    await rm(partPath, { force: true });
    offset = 0;
    return downloadResumable(options);
  }
  if (response.body === null) {
    throw new Error(`empty response body for ${url}`);
  }

  // Fresh download truncates any stale part; a resume appends in place.
  if (offset === 0) {
    await writeFile(partPath, new Uint8Array(0));
  }
  const stream = createWriteStream(partPath, { flags: 'a' });

  const reader = response.body.getReader();
  let received = offset;
  const expected = options.expectedBytes ?? 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        stream.write(value);
        received += value.byteLength;
        options.onProgress?.({ received, expected });
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });
    reader.releaseLock();
  }

  const digest = await sha256File(partPath);
  if (digest !== expectedSha256) {
    await rm(partPath, { force: true });
    throw new Error(`checksum mismatch for ${target}: expected ${expectedSha256}, got ${digest}`);
  }
  await rename(partPath, target);
};

/**
 * Extracts a `.tar.bz2` archive into a target directory, detecting the
 * tarball's single top-level directory and moving it into place.
 *
 * @param tarball — Path to the archive.
 * @param targetDir — Destination directory.
 */
export const extractTarBz2 = async (options: {
  tarball: string;
  targetDir: string;
}): Promise<void> => {
  const { tarball, targetDir } = options;
  const extractRoot = `${targetDir}.extract`;
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xjf', tarball, '-C', extractRoot], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar extraction failed with exit ${code ?? 'unknown'}`));
      }
    });
  });

  // The sherpa tarballs carry a single top-level directory whose name equals
  // the target directory name. Move it into place; fall back to merging the
  // contents if the layout differs.
  const rootEntries = await readdir(extractRoot);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(dirname(targetDir), { recursive: true });
  if (rootEntries.length === 1) {
    await rename(join(extractRoot, rootEntries[0] as string), targetDir);
  } else {
    await rename(extractRoot, targetDir);
  }
};

/**
 * Verifies the state of an entry on disk without downloading.
 *
 * @returns 'complete' when the completion marker exists, 'corrupt' when the
 *          target exists but its digest does not match, 'missing' otherwise.
 */
export const verifyEntryState = async (options: {
  entry: ManifestEntry;
  modelsDir: string;
}): Promise<'complete' | 'corrupt' | 'missing'> => {
  const { entry, modelsDir } = options;
  if (entry.kind === 'archive') {
    const marker = join(modelsDir, entry.targetPath, COMPLETE_MARKER);
    return existsSync(marker) ? 'complete' : 'missing';
  }
  const target = join(modelsDir, entry.targetPath);
  const marker = `${target}${COMPLETE_MARKER}`;
  if (existsSync(marker)) {
    return 'complete';
  }
  if (existsSync(target)) {
    const digest = await sha256File(target);
    return digest === entry.sha256 ? 'complete' : 'corrupt';
  }
  return 'missing';
};

/**
 * Ensures a single manifest entry is present and verified on disk.
 *
 * @returns 'fetched' when a new download/extract happened, 'already-present'
 *          when nothing needed doing, 'skipped-ack' when the entry is
 *          licence-gated and not accepted.
 */
export const ensureEntry = async (options: {
  entry: ManifestEntry;
  modelsDir: string;
  acceptLicenses: ReadonlySet<string>;
  onProgress?: (options: { entryId: string; received: number; expected: number }) => void;
}): Promise<'fetched' | 'already-present' | 'skipped-ack'> => {
  const { entry, modelsDir, acceptLicenses } = options;

  if (entry.requiresAcknowledgement && !acceptLicenses.has(entry.license)) {
    // biome-ignore lint/suspicious/noConsole: container log (standalone script)
    console.log(
      `[fetcher] skip ${entry.id}: licence ${entry.license} not accepted (${entry.url ?? ''})`,
    );
    return 'skipped-ack';
  }

  const state = await verifyEntryState({ entry, modelsDir });
  if (state === 'complete') {
    return 'already-present';
  }
  if (state === 'corrupt') {
    await rm(join(modelsDir, entry.targetPath), { force: true });
    await rm(`${join(modelsDir, entry.targetPath)}${PART_SUFFIX}`, { force: true });
    await rm(`${join(modelsDir, entry.targetPath)}${COMPLETE_MARKER}`, { force: true });
  }

  if (entry.kind === 'archive') {
    const cacheDir = join(modelsDir, '.cache');
    await mkdir(cacheDir, { recursive: true });
    const tarball = join(cacheDir, `${entry.id}.tar.bz2`);
    // Re-fetch the tarball when its digest no longer matches.
    if (existsSync(tarball)) {
      const digest = await sha256File(tarball);
      if (digest !== entry.sha256) {
        await rm(tarball, { force: true });
      }
    }
    if (!existsSync(tarball)) {
      await downloadResumable({
        url: resolveEntryUrl(entry),
        target: tarball,
        expectedSha256: entry.sha256,
        expectedBytes: entry.bytes,
        onProgress: (p) =>
          options.onProgress?.({ entryId: entry.id, received: p.received, expected: p.expected }),
      });
    }
    await extractTarBz2({ tarball, targetDir: join(modelsDir, entry.targetPath) });
    await writeFile(join(modelsDir, entry.targetPath, COMPLETE_MARKER), 'ok\n');
    return 'fetched';
  }

  const target = join(modelsDir, entry.targetPath);
  await downloadResumable({
    url: resolveEntryUrl(entry),
    target,
    expectedSha256: entry.sha256,
    expectedBytes: entry.bytes,
    onProgress: (p) =>
      options.onProgress?.({ entryId: entry.id, received: p.received, expected: p.expected }),
  });
  await writeFile(`${target}${COMPLETE_MARKER}`, 'ok\n');
  return 'fetched';
};

/**
 * Hands the populated models tree to the runtime engine uid (C-390 Edge
 * Cases). The fetcher runs as root, but the voice container runs as a
 * non-root user (uid 1000 by default, VOICE_UID/VOICE_GID in
 * docker/voice/Dockerfile.sherpa). A named volume first written by the root
 * fetcher is root-owned 755, so the voice entrypoint's mkdir fails and the
 * container restart-loops. Chown the tree to MODELS_UID:MODELS_GID (default
 * 1000:1000) so every engine can write/read it. Only meaningful when the
 * process runs as root (the compose fetcher); on the host (unit tests) the
 * call is a no-op so a non-root developer is not forced to own the tree.
 */
export const chownModels = async (modelsDir: string): Promise<void> => {
  if (process.env.MODELS_CHOWN === '0') {
    // AC-13 MODELS_PATH bind mounts are the user's own host tree — never
    // change its ownership (Migration & Rollback promise).
    return;
  }
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    return;
  }
  const uid = Number(process.env.MODELS_UID ?? '1000');
  const gid = Number(process.env.MODELS_GID ?? '1000');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('chown', ['-R', `${uid}:${gid}`, modelsDir], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`chown failed with exit ${code ?? 'unknown'}`));
        }
      });
    });
    // biome-ignore lint/suspicious/noConsole: container log (standalone script)
    console.log(`[fetcher] chowned ${modelsDir} to ${uid}:${gid}`);
  } catch (error) {
    // Non-fatal: engines that run as root or use a MODELS_PATH bind they own
    // still work; the voice entrypoint tolerates an unwritable stt dir.
    // biome-ignore lint/suspicious/noConsole: container log
    console.warn(
      `[fetcher] chown ${modelsDir} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Runs the fetcher for the enabled profiles.
 *
 * @returns Process exit code — 0 when every enabled modality was attempted
 *          (individual download failures are non-fatal, AC-6), 1 on invalid
 *          input or when no modality is enabled.
 */
export const run = async (options: {
  manifestPath?: string;
  modelsDir?: string;
  profiles?: string;
  acceptLicenses?: string;
  entryId?: string;
  /** Explicit entry ids to fetch — limits the run to exactly these planned models. */
  entryIds?: readonly string[];
  /** C-393 STT tier selection (overrides STT_STREAM_MODEL env). */
  sttStreamModel?: string;
  /** C-393 STT tier selection (overrides STT_BATCH_MODEL env). */
  sttBatchModel?: string;
  onProgress?: (options: { entryId: string; received: number; expected: number }) => void;
}): Promise<number> => {
  const manifestPath = options.manifestPath ?? join(import.meta.dir, 'models.manifest.json');
  const modelsDir =
    options.modelsDir ?? process.env.AIKAMI_MODELS_DIR ?? process.env.MODELS_PATH ?? '/models';
  const profilesRaw = options.profiles ?? process.env.COMPOSE_PROFILES ?? 'text,image,voice,stt';
  const profiles = profilesRaw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const acceptLicensesRaw = options.acceptLicenses ?? process.env.AIKAMI_ACCEPT_LICENSES ?? '';
  const acceptLicenses = new Set(
    acceptLicensesRaw
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean),
  );

  let manifest: Manifest;
  try {
    manifest = await loadManifest(manifestPath);
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: container log (standalone script)
    console.error(`[fetcher] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const enabledModalities = new Set<Modality>();
  for (const profile of profiles) {
    const modalities = PROFILE_MODALITY[profile];
    if (!modalities) {
      // biome-ignore lint/suspicious/noConsole: container log
      console.warn(`[fetcher] unknown profile: ${profile}`);
      continue;
    }
    for (const modality of modalities) {
      enabledModalities.add(modality);
    }
  }

  if (enabledModalities.size === 0) {
    // biome-ignore lint/suspicious/noConsole: container log
    console.log(
      `[fetcher] no model-bearing profiles enabled (${profilesRaw || '(none)'}) — nothing to fetch`,
    );
    return 0;
  }

  await mkdir(modelsDir, { recursive: true });

  // C-393: the stt profile is tier-selected by STT_STREAM_MODEL / STT_BATCH_MODEL
  // (defaults: minimal tier). An explicit --entry / entryIds request bypasses
  // the tier filter — the caller asked for exactly those models.
  const explicitEntryFilter = options.entryId || options.entryIds;
  const sttSelection = new Set(
    selectSttEntries({
      entries: manifest.entries,
      streamModel: options.sttStreamModel ?? process.env.STT_STREAM_MODEL ?? undefined,
      batchModel: options.sttBatchModel ?? process.env.STT_BATCH_MODEL ?? undefined,
    }).map((entry) => entry.id),
  );

  const selectedEntries = manifest.entries.filter(
    (entry) =>
      enabledModalities.has(entry.modality) &&
      (!options.entryId || entry.id === options.entryId) &&
      (!options.entryIds || options.entryIds.includes(entry.id)) &&
      (explicitEntryFilter || entry.modality !== 'stt' || sttSelection.has(entry.id)),
  );

  if (selectedEntries.length === 0) {
    // biome-ignore lint/suspicious/noConsole: container log
    console.log(`[fetcher] no manifest entries for profiles: ${profilesRaw}`);
    return 0;
  }

  const failures: string[] = [];
  const results = new Map<string, string>();
  for (const entry of selectedEntries) {
    try {
      const status = await ensureEntry({
        entry,
        modelsDir,
        acceptLicenses,
        onProgress: options.onProgress,
      });
      results.set(entry.id, status);
      // biome-ignore lint/suspicious/noConsole: container log
      console.log(`[fetcher] ${entry.id}: ${status}`);
    } catch (error) {
      failures.push(entry.id);
      results.set(entry.id, 'failed');
      // biome-ignore lint/suspicious/noConsole: container log
      console.error(
        `[fetcher] ${entry.id}: failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    // biome-ignore lint/suspicious/noConsole: container log
    console.warn(
      `[fetcher] ${failures.length} model(s) failed (non-fatal): ${failures.join(', ')}`,
    );
  }
  // Hand the volume to the engine uid so non-root engines (voice, uid 1000)
  // can mkdir/write under /models instead of crash-looping (C-390 Edge Cases).
  await chownModels(modelsDir);
  return 0;
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  let entryId: string | undefined;
  let modelsDir: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--entry') {
      entryId = args[i + 1];
      i += 1;
    } else if (arg === '--models-dir') {
      modelsDir = args[i + 1];
      i += 1;
    }
  }
  process.exit(await run({ entryId, modelsDir }));
}
