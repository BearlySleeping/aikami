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

const main = (): void => {
  const checkOnly = process.argv.includes('--check');
  const manifest = JSON.parse(
    readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
  ) as { audio?: { bindings: { cueId: string; tag: string; sha256: string }[] } };

  const pinned = new Map(
    (manifest.audio?.bindings ?? []).map((binding) => [binding.tag, binding.sha256]),
  );

  const installed: { tag: string; path: string; sha256: string }[] = [];
  for (const [tag, file] of CUES) {
    const source = join(packAudio, file);
    if (!existsSync(source)) {
      throw new Error(`install_emberwatch_audio: ${source} is missing`);
    }
    const sourceHash = sha256(source);
    const declared = pinned.get(tag);
    if (declared !== undefined && declared !== sourceHash) {
      throw new Error(
        `install_emberwatch_audio: ${file} hashes ${sourceHash.slice(0, 12)} but the manifest pins ${declared.slice(0, 12)} for ${tag} — refusing to publish bytes that do not satisfy the pin`,
      );
    }
    const relative = runtimePathFor(tag, '.webm');
    const destination = join(repository, 'apps/frontend/client/static/game-data', relative);
    installed.push({ tag, path: relative, sha256: sourceHash });
    if (!checkOnly) {
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
  }

  console.log(
    `install_emberwatch_audio: ${installed.length} authored bed(s) published under their pinned tags${checkOnly ? ' (check only)' : ''}`,
  );
  for (const entry of installed) {
    console.log(`  ${entry.tag} → ${entry.path}`);
  }
};

main();
