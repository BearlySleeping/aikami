// scripts/src/lib/ops/install_emberwatch_audio.ts
//
// Publishes the pack's authored audio beds under the tags the pack manifest
// actually pins.
//
// The pack declares its cues by authored identity — `music:exploration:village_ward`,
// `music:combat:emberwatch_combat` — and pins each one's exact SHA-256. The
// files live in `content/packs/emberwatch/audio/`, where the content-packs scan
// root would tag them `emberwatch:audio:<name>`; that tag is NOT what the
// manifest pins, so the installed pack lock reported every cue as
// `audio-cue-unpublished` and the release was refused.
//
// The local asset origin already serves these five beds under their authored
// tags (`local_asset_origin.ts`, "publishing them is C-513"). This is that
// publication: the same files, mirrored into the game-data root's `music`
// category, where the catalog scan derives exactly the pinned tag.
//
// The bytes are copied verbatim — never re-encoded — so the SHA-256 the manifest
// pins is the SHA-256 the catalog publishes.
//
// Run: bun scripts/src/lib/ops/install_emberwatch_audio.ts [--check]

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const packAudio = join(repository, 'content/packs/emberwatch/audio');

/** Authored cue tag → the pack file that satisfies it. Mirrors the origin. */
const CUES: readonly [tag: string, file: string][] = [
  ['music:exploration:village_ward', 'village_ward.webm'],
  ['music:exploration:inn_hearth', 'inn_hearth.webm'],
  ['music:exploration:old_road', 'old_road.webm'],
  ['music:exploration:ruined_shrine', 'ruined_shrine.webm'],
  ['music:combat:emberwatch_combat', 'emberwatch_combat.webm'],
];

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** `music:exploration:village_ward` → `music/exploration/village_ward.webm`. */
const runtimePathFor = (tag: string, ext: string): string => `${tag.replace(/:/g, '/')}${ext}`;

/**
 * Resolves one authored audio bed against its manifest pin, without writing.
 *
 * A tag whose manifest pin disagrees with the file on disk is a producer
 * defect: publishing it would ship bytes the client is required to refuse.
 * Separated from the write so every cue can be validated before any of them
 * is copied — a bad pin must not leave the runtime tree half-updated.
 */
const resolveCue = (options: {
  tag: string;
  file: string;
  pinned: Map<string, string>;
}): { tag: string; path: string; source: string; destination: string; sha256: string } => {
  const source = join(packAudio, options.file);
  if (!existsSync(source)) {
    throw new Error(`install_emberwatch_audio: ${source} is missing`);
  }
  const sourceHash = sha256(source);
  const declared = options.pinned.get(options.tag);
  if (declared !== undefined && declared !== sourceHash) {
    throw new Error(
      `install_emberwatch_audio: ${options.file} hashes ${sourceHash.slice(0, 12)} but the manifest pins ${declared.slice(0, 12)} for ${options.tag} — refusing to publish bytes that do not satisfy the pin`,
    );
  }
  const path = runtimePathFor(options.tag, '.webm');
  return {
    tag: options.tag,
    path,
    source,
    destination: join(repository, 'apps/frontend/client/static/game-data', path),
    sha256: sourceHash,
  };
};

/**
 * Publishes one resolved cue, or verifies it under `--check`.
 *
 * `--check` compares BYTES, not existence: a destination that exists but holds
 * different audio is exactly the drift this command exists to catch.
 */
const publishCue = (options: {
  cue: ReturnType<typeof resolveCue>;
  checkOnly: boolean;
}): { tag: string; path: string; sha256: string } => {
  const { cue, checkOnly } = options;
  if (checkOnly) {
    if (!existsSync(cue.destination) || sha256(cue.destination) !== cue.sha256) {
      throw new Error(
        `install_emberwatch_audio: installed ${cue.path} is missing or differs from ${cue.source}`,
      );
    }
  } else {
    mkdirSync(dirname(cue.destination), { recursive: true });
    copyFileSync(cue.source, cue.destination);
  }
  return { tag: cue.tag, path: cue.path, sha256: cue.sha256 };
};

const main = (): void => {
  const checkOnly = process.argv.includes('--check');
  const manifest = JSON.parse(
    readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
  ) as {
    audio?: {
      bindings: {
        cueId: string;
        tag: string;
        sha256: string;
        resolution?: string;
        fallback?: string;
      }[];
    };
  };

  const bindings = manifest.audio?.bindings ?? [];
  const pinned = new Map(bindings.map((binding) => [binding.tag, binding.sha256]));

  // Coverage is proved BEFORE the first mutation. A manifest binding with no
  // installer source entry would otherwise be silently uncovered: the loop
  // below only walks CUES, so a pin the installer does not know about would
  // never be reported and the pack lock would carry a cue with no bytes.
  //
  // Only bindings the pack is REQUIRED to ship must be covered. A binding
  // declared `optional` with a `silence` fallback is by definition one the
  // pack may omit — `bed.explore`/`bed.combat` are exactly that: generic
  // fallback beds the Emberwatch pack does not author, so their absence is
  // the declared policy rather than a gap. Anything else must be covered.
  const covered = new Set(CUES.map(([tag]) => tag));
  const uncovered = bindings
    .filter((binding) => !covered.has(binding.tag))
    .filter((binding) => !(binding.resolution === 'optional' && binding.fallback === 'silence'))
    .map((binding) => binding.tag)
    .sort();
  if (uncovered.length > 0) {
    throw new Error(
      `install_emberwatch_audio: ${uncovered.length} manifest-pinned binding(s) have no installer source entry — refusing to publish a partially covered pack:\n` +
        uncovered.map((tag) => `  ${tag}`).join('\n'),
    );
  }

  // Resolve every cue first, then write. A cue that fails its pin check must
  // not leave the earlier cues already copied into the runtime tree.
  const resolved = CUES.map(([tag, file]) => resolveCue({ tag, file, pinned }));
  const installed = resolved.map((cue) => publishCue({ cue, checkOnly }));

  console.log(
    `install_emberwatch_audio: ${installed.length} authored bed(s) published under their pinned tags${checkOnly ? ' (check only)' : ''}`,
  );
  for (const entry of installed) {
    console.log(`  ${entry.tag} → ${entry.path}`);
  }
};

main();
