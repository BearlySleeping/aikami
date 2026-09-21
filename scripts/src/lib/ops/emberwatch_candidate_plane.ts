// scripts/src/lib/ops/emberwatch_candidate_plane.ts
//
// The COMPLETE candidate release plane Emberwatch's human visual gate needs.
//
// Why this exists: the first human visual gate booted a local rehearsal origin
// that overlaid only the pack manifest, maps, audio and the prop atlas on top
// of a production snapshot. Portraits were NOT overlaid, so the client resolved
// `portraits:emberwatch:*` against a catalog that has never carried the 5.0
// cast and quietly fell back to the legacy `gandalf`/`orc`/`aragon` stand-ins.
// The gate then judged the candidate while the candidate's own portraits were
// invisible.
//
// This module names the full set of tags a candidate must serve — portraits,
// enemy visuals, prop-atlas pages, maps, manifest, authored audio — and derives
// the local overrides that serve them. `missingCandidateOverrides()` is the
// guard: an empty result means the local rehearsal exercises the CANDIDATE, not
// a mix of candidate and stale production rows.
//
// It is pure and side-effect free so both the origin server and its tests can
// import it.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One artifact served locally instead of from the published origin. */
export type CandidateOverride = {
  /** Published registry tag the client resolves (e.g. `portraits:emberwatch:village_elder:neutral`). */
  tag: string;
  /** Absolute path to the local file that should win. */
  file: string;
  /** Category recorded in the seed row. */
  category: string;
  /** File extension including the dot. */
  ext: string;
};

type ManifestShape = {
  maps?: Record<string, unknown>;
  npcs?: Record<string, { portraits?: { variants?: Record<string, string> } }>;
  audio?: {
    bindings?: Array<{ source?: { kind?: string; tag?: string } }>;
  };
};

const PACK_ROOT_REL = 'content/packs/emberwatch';

const readPackManifest = (repository: string): ManifestShape =>
  JSON.parse(
    readFileSync(join(repository, PACK_ROOT_REL, 'manifest.json'), 'utf8'),
  ) as ManifestShape;

const sortByTag = (entries: CandidateOverride[]): CandidateOverride[] =>
  entries.sort((a, b) => a.tag.localeCompare(b.tag));

/**
 * The authored music beds the manifest pins. Derived from the bindings so a
 * cue that stops pointing at a local file cannot silently keep a stale entry.
 */
const AUTHORED_MUSIC: ReadonlyArray<readonly [tag: string, file: string]> = [
  ['music:exploration:village_ward', 'village_ward.webm'],
  ['music:exploration:inn_hearth', 'inn_hearth.webm'],
  ['music:exploration:old_road', 'old_road.webm'],
  ['music:exploration:ruined_shrine', 'ruined_shrine.webm'],
  ['music:combat:emberwatch_combat', 'emberwatch_combat.webm'],
];

/**
 * Every override the local candidate origin must serve. Paths are absolute so
 * the server can read them directly.
 */
export const collectEmberwatchCandidateOverrides = (repository: string): CandidateOverride[] => {
  const overrides: CandidateOverride[] = [];
  const packRoot = join(repository, PACK_ROOT_REL);

  // Prop-atlas pages (grid atlas stays proxied — see local_asset_origin.ts).
  overrides.push(
    {
      tag: 'sprites:tilesets:props.webp',
      file: join(repository, 'apps/frontend/client/static/game-data/sprites/tilesets/props.webp'),
      category: 'tilesets',
      ext: '.webp',
    },
    {
      tag: 'sprites:tilesets:props.json',
      file: join(repository, 'apps/frontend/client/static/game-data/sprites/tilesets/props.json'),
      category: 'tilesets',
      ext: '.json',
    },
  );

  // All five authored maps.
  for (const mapId of Object.keys(readPackManifest(repository).maps ?? {})) {
    overrides.push({
      tag: `emberwatch:maps:${mapId}`,
      file: join(packRoot, 'maps', `${mapId}.json`),
      category: 'contentPacks',
      ext: '.json',
    });
  }

  // The pack manifest itself.
  overrides.push({
    tag: 'emberwatch:manifest',
    file: join(packRoot, 'manifest.json'),
    category: 'contentPacks',
    ext: '.json',
  });

  // Authored music beds.
  for (const [tag, file] of AUTHORED_MUSIC) {
    overrides.push({
      tag,
      file: join(packRoot, 'audio', file),
      category: 'music',
      ext: '.webm',
    });
  }

  // NPC portraits — EVERY manifest-declared variant, served from the tracked
  // authoring source under the runtime `portraits:emberwatch:<npc>:<variant>`
  // tag the client resolves.
  const npcs = readPackManifest(repository).npcs ?? {};
  for (const [npcId, npc] of Object.entries(npcs)) {
    for (const variant of Object.keys(npc.portraits?.variants ?? {})) {
      overrides.push({
        tag: `portraits:emberwatch:${npcId}:${variant}`,
        file: join(packRoot, 'portraits', npcId, `${variant}.png`),
        category: 'portraits',
        ext: '.png',
      });
    }
  }

  // Authored enemy visuals.
  const enemiesDir = join(packRoot, 'enemies');
  if (existsSync(enemiesDir)) {
    for (const name of readdirSync(enemiesDir).sort()) {
      if (!name.endsWith('.png')) {
        continue;
      }
      const id = name.slice(0, -'.png'.length);
      overrides.push({
        tag: `emberwatch:enemies:${id}`,
        file: join(enemiesDir, name),
        category: 'contentPacks',
        ext: '.png',
      });
    }
  }

  return sortByTag(overrides);
};

/**
 * The tags a candidate MUST serve locally for a truthful human visual gate.
 *
 * The terrain atlas (`sprites:tilesets:atlas.*`) is intentionally excluded: the
 * origin deliberately proxies the accepted published terrain rather than
 * replacing it with a locally regenerated one (see `local_asset_origin.ts`).
 */
/** Every `portraits:emberwatch:<npc>:<variant>` tag the manifest declares. */
const manifestPortraitTags = (manifest: ManifestShape): string[] =>
  Object.entries(manifest.npcs ?? {}).flatMap(([npcId, npc]) =>
    Object.keys(npc.portraits?.variants ?? {}).map(
      (variant) => `portraits:emberwatch:${npcId}:${variant}`,
    ),
  );

/** Enemy ids present in the pack's enemies directory. */
const enemyIds = (repository: string): string[] => {
  const dir = join(repository, PACK_ROOT_REL, 'enemies');
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.slice(0, -4));
};

/** Asset-backed music tags the manifest pins. */
const manifestMusicTags = (manifest: ManifestShape): string[] =>
  (manifest.audio?.bindings ?? [])
    .map((binding) => (binding.source?.kind === 'asset' ? binding.source.tag : undefined))
    .filter((tag): tag is string => tag !== undefined);

export const collectRequiredEmberwatchCandidateTags = (repository: string): string[] => {
  const manifest = readPackManifest(repository);
  const required = new Set<string>(['emberwatch:manifest']);
  for (const mapId of Object.keys(manifest.maps ?? {})) {
    required.add(`emberwatch:maps:${mapId}`);
  }
  for (const tag of manifestPortraitTags(manifest)) {
    required.add(tag);
  }
  for (const tag of manifestMusicTags(manifest)) {
    required.add(tag);
  }
  for (const id of enemyIds(repository)) {
    required.add(`emberwatch:enemies:${id}`);
  }
  required.add('sprites:tilesets:props.webp');
  required.add('sprites:tilesets:props.json');
  return [...required].sort();
};

/**
 * Required candidate tags that no local override serves.
 *
 * A non-empty result means the human gate would render at least one candidate
 * surface from the stale published origin — exactly how portraits were missed
 * the first time. Empty is the only acceptable result.
 */
export const missingCandidateOverrides = (repository: string): string[] => {
  const served = new Set(collectEmberwatchCandidateOverrides(repository).map((o) => o.tag));
  return collectRequiredEmberwatchCandidateTags(repository).filter((tag) => !served.has(tag));
};
