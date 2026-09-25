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

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

const TILESET_DIR_REL = 'apps/frontend/client/static/game-data/sprites/tilesets';

const readPackManifest = (repository: string): ManifestShape =>
  JSON.parse(
    readFileSync(join(repository, PACK_ROOT_REL, 'manifest.json'), 'utf8'),
  ) as ManifestShape;

const sortByTag = (entries: CandidateOverride[]): CandidateOverride[] =>
  entries.sort((a, b) => a.tag.localeCompare(b.tag));

/** SHA-256 of a local file, or undefined when it is not present. */
const localSha256 = (path: string): string | undefined =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined;

/**
 * The published tag → sha256 map from a catalog snapshot's compact seed.
 *
 * The snapshot seed is the origin's source of published rows, so it is also the
 * authority for "what would the origin proxy". Returns an empty map when the
 * seed is absent, which the atlas rule reads as "published unknown → serve the
 * local build".
 */
export const readPublishedSeedHashes = (seedPath: string): Map<string, string> => {
  const hashes = new Map<string, string>();
  if (!existsSync(seedPath)) {
    return hashes;
  }
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
    r?: Array<{ t?: string; h?: string }>;
  };
  for (const row of seed.r ?? []) {
    if (typeof row.t === 'string' && typeof row.h === 'string') {
      hashes.set(row.t, row.h);
    }
  }
  return hashes;
};

/**
 * The compact seed inside a snapshot directory, in either layout.
 *
 * A legacy snapshot writes `remote/seed/asset_seed.json`; a release snapshot
 * writes the seed content-addressed as `remote/seed/<hash>/asset_seed.json`
 * (the key `release.json` pins). Both are the same document shape.
 */
const snapshotSeedFile = (snapshotDir: string): string | undefined => {
  const direct = join(snapshotDir, 'remote/seed/asset_seed.json');
  if (existsSync(direct)) {
    return direct;
  }
  const seedRoot = join(snapshotDir, 'remote/seed');
  if (!existsSync(seedRoot)) {
    return undefined;
  }
  for (const name of readdirSync(seedRoot)) {
    const candidate = join(seedRoot, name, 'asset_seed.json');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

/**
 * The newest catalog snapshot's compact-seed path, or undefined when no
 * snapshot has been taken. Snapshot directories are content-digest named, so
 * recency is by modification time, not lexicographic order.
 */
export const findPublishedSeedPath = (repository: string): string | undefined => {
  const base = join(repository, '.local/catalog/production/snapshots');
  if (!existsSync(base)) {
    return undefined;
  }
  const newest = readdirSync(base)
    .map((name) => {
      try {
        return { name, mtimeMs: statSync(join(base, name)).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { name: string; mtimeMs: number } => entry !== undefined)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return newest ? snapshotSeedFile(join(base, newest.name)) : undefined;
};

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

/** One terrain-atlas member: the runtime tag, its local file and its extension. */
type AtlasMember = { tag: string; file: string; ext: string };

/** The two terrain-atlas members (texture + descriptor) at their runtime paths. */
const terrainAtlasMembers = (repository: string): AtlasMember[] => {
  const tilesetRoot = join(repository, TILESET_DIR_REL);
  return [
    { tag: 'sprites:tilesets:atlas.webp', file: join(tilesetRoot, 'atlas.webp'), ext: '.webp' },
    { tag: 'sprites:tilesets:atlas.json', file: join(tilesetRoot, 'atlas.json'), ext: '.json' },
  ];
};

/**
 * Terrain-atlas members whose local bytes differ from the published seed, or
 * whose published hash is unknown. Shared by the override set and the required
 * set so the two can never disagree about the atlas.
 */
const divergentTerrainAtlasMembers = (
  repository: string,
  publishedHashes?: ReadonlyMap<string, string>,
): AtlasMember[] =>
  terrainAtlasMembers(repository).filter((member) => {
    const localHash = localSha256(member.file);
    if (localHash === undefined) {
      return false;
    }
    const publishedHash = publishedHashes?.get(member.tag);
    return publishedHash === undefined || publishedHash !== localHash;
  });

/**
 * NPC portrait overrides — EVERY manifest-declared variant, served from the
 * tracked authoring source under the runtime
 * `portraits:emberwatch:<npc>:<variant>` tag the client resolves.
 */
const portraitOverrides = (packRoot: string, manifest: ManifestShape): CandidateOverride[] =>
  Object.entries(manifest.npcs ?? {}).flatMap(([npcId, npc]) =>
    Object.keys(npc.portraits?.variants ?? {}).map((variant) => ({
      tag: `portraits:emberwatch:${npcId}:${variant}`,
      file: join(packRoot, 'portraits', npcId, `${variant}.png`),
      category: 'portraits',
      ext: '.png',
    })),
  );

/** Authored enemy visuals present in the pack's `enemies/` directory. */
const enemyOverrides = (packRoot: string): CandidateOverride[] => {
  const enemiesDir = join(packRoot, 'enemies');
  if (!existsSync(enemiesDir)) {
    return [];
  }
  return readdirSync(enemiesDir)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => ({
      tag: `emberwatch:enemies:${name.slice(0, -'.png'.length)}`,
      file: join(enemiesDir, name),
      category: 'contentPacks',
      ext: '.png',
    }));
};

/**
 * Every override the local candidate origin must serve. Paths are absolute so
 * the server can read them directly.
 *
 * The terrain atlas is included ONLY when the candidate's local build differs
 * from the published bytes the origin would otherwise proxy (C-548). The
 * original exclusion ("the origin deliberately proxies the accepted published
 * terrain rather than replacing it with a locally regenerated one") assumed the
 * atlas was stable across a candidate. C-546 changed that: it appended bridge
 * frames 129-145 and grew the atlas 544×272 → 544×340; C-553 appends
 * house GIDs 161-176 and grows it again to 544×374. A candidate whose maps
 * paint any appended GID would render from the fallback if the published atlas
 * were proxied. The rule below preserves the intent —
 * unchanged atlas bytes are still proxied, so a local-origin run does not
 * silently swap accepted art — while forcing the local build to win the moment
 * its content differs from what is published.
 *
 * When no published hash is known (an empty or absent snapshot) the atlas is
 * included: serving the candidate's own bytes is the safe default, and the
 * control-plane GID check (`emberwatch_atlas_coverage.ts`) is what catches a
 * genuinely broken build.
 *
 * @param repository - Monorepo root.
 * @param publishedHashes - tag → sha256 from the published seed, when known.
 */
export const collectEmberwatchCandidateOverrides = (
  repository: string,
  publishedHashes?: ReadonlyMap<string, string>,
): CandidateOverride[] => {
  const packRoot = join(repository, PACK_ROOT_REL);
  const manifest = readPackManifest(repository);

  const overrides: CandidateOverride[] = [
    // Prop-atlas pages (always served from the local build — they are the C-529
    // candidate plane and carry no "accepted published art" exception).
    {
      tag: 'sprites:tilesets:props.webp',
      file: join(repository, TILESET_DIR_REL, 'props.webp'),
      category: 'tilesets',
      ext: '.webp',
    },
    {
      tag: 'sprites:tilesets:props.json',
      file: join(repository, TILESET_DIR_REL, 'props.json'),
      category: 'tilesets',
      ext: '.json',
    },
    // Terrain atlas — included only when its local bytes differ from the
    // published ones, or when the published hash is unknown (see the doc
    // comment above).
    ...divergentTerrainAtlasMembers(repository, publishedHashes).map((member) => ({
      ...member,
      category: 'tilesets',
    })),
    // All five authored maps.
    ...Object.keys(manifest.maps ?? {}).map((mapId) => ({
      tag: `emberwatch:maps:${mapId}`,
      file: join(packRoot, 'maps', `${mapId}.json`),
      category: 'contentPacks',
      ext: '.json',
    })),
    // The pack manifest itself.
    {
      tag: 'emberwatch:manifest',
      file: join(packRoot, 'manifest.json'),
      category: 'contentPacks',
      ext: '.json',
    },
    // Authored music beds.
    ...AUTHORED_MUSIC.map(([tag, file]) => ({
      tag,
      file: join(packRoot, 'audio', file),
      category: 'music',
      ext: '.webm',
    })),
    ...portraitOverrides(packRoot, manifest),
    ...enemyOverrides(packRoot),
  ];

  return sortByTag(overrides);
};

/**
 * The tags a candidate MUST serve locally for a truthful human visual gate.
 *
 * The terrain atlas is required conditionally: only when the local build
 * diverges from the published bytes (C-548). An unchanged atlas is proxied from
 * the published origin and is legitimately not an override; a divergent one is
 * both required and served (see `collectTerrainAtlasTags`).
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

export const collectRequiredEmberwatchCandidateTags = (
  repository: string,
  publishedHashes?: ReadonlyMap<string, string>,
): string[] => {
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
  // The terrain atlas is required of the local plane exactly when the local
  // build differs from the published bytes (C-548) — the same condition that
  // adds it to the override set. Requiring it unconditionally would flag a
  // legitimate unchanged-atlas candidate as incomplete.
  for (const tag of collectTerrainAtlasTags(repository, publishedHashes)) {
    required.add(tag);
  }
  return [...required].sort();
};

/** Terrain-atlas tags the local plane must serve, given the published hashes. */
const collectTerrainAtlasTags = (
  repository: string,
  publishedHashes?: ReadonlyMap<string, string>,
): string[] =>
  divergentTerrainAtlasMembers(repository, publishedHashes).map((member) => member.tag);

/**
 * Required candidate tags that no local override serves.
 *
 * A non-empty result means the human gate would render at least one candidate
 * surface from the stale published origin — exactly how portraits were missed
 * the first time. Empty is the only acceptable result.
 *
 * @param repository - Monorepo root.
 * @param publishedHashes - tag → sha256 from the published seed, when known.
 *   Passing it lets the terrain atlas be required only when it diverges (C-548).
 */
export const missingCandidateOverrides = (
  repository: string,
  publishedHashes?: ReadonlyMap<string, string>,
): string[] => {
  const served = new Set(
    collectEmberwatchCandidateOverrides(repository, publishedHashes)
      .filter((override) => existsSync(override.file))
      .map((override) => override.tag),
  );
  return collectRequiredEmberwatchCandidateTags(repository, publishedHashes).filter(
    (tag) => !served.has(tag),
  );
};
