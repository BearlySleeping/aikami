// scripts/src/lib/ops/emberwatch_candidate.ts
//
// Builds and seals the Emberwatch release candidate.
//
//   --seal     build the lock from a CLEAN committed tree and write it
//   --verify   re-derive and compare against the sealed lock
//   --show     print the sealed lock's identity without re-deriving
//
// The lock is a RELEASE ARTIFACT, not a committed file: it lives under
// `.local/releases/` so that `source.commit` is genuinely the commit the bytes
// came from. A lock committed inside the commit it describes is circular and
// permanently stale — see the schema header.
//
// Sealing refuses a dirty tree, with no escape hatch: a candidate intended for
// staging or production must correspond to a committed source state, or the
// lock cannot be re-derived by anyone else.
//
// Run: bun scripts/src/lib/ops/emberwatch_candidate.ts --seal
//      bun scripts/src/lib/ops/emberwatch_candidate.ts --verify

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CandidateLock, CandidateLockSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import {
  buildGroups,
  type DeclaredGroup,
  diffCandidateLocks,
  gate,
  sealCandidate,
} from '../catalog/candidate_lock.ts';
import { runEmberwatchRightsAudit } from './emberwatch_rights_audit.ts';
import { runSurfaceAudit } from './emberwatch_surface_audit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');

const PACK_ROOT = join(repository, 'content/packs/emberwatch');
const GAME_DATA = join(repository, 'apps/frontend/client/static/game-data');
const RELEASE_PLANE = join(repository, '.local/releases');

const IMAGES = ['.png', '.webp'] as const;
const MEDIA = ['.webm', '.ogg', '.mp3', '.wav'] as const;

const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();

/** Resolves a manifest URL like `/game-data/sprites/tilesets/atlas.webp`. */
const resolveGameDataUrl = (url: string): string => {
  const marker = '/game-data/';
  const index = url.indexOf(marker);
  if (index === -1) {
    return resolve(repository, url.replace(/^\//, ''));
  }
  return join(GAME_DATA, url.slice(index + marker.length));
};

/** Resolves a manifest URL like `/content-packs/emberwatch/maps/village.json`. */
const resolvePackUrl = (url: string): string => {
  const marker = '/content-packs/emberwatch/';
  const index = url.indexOf(marker);
  if (index === -1) {
    return resolve(PACK_ROOT, url.replace(/^\//, ''));
  }
  return join(PACK_ROOT, url.slice(index + marker.length));
};

type PackManifest = {
  version?: string;
  atlas?: { textureUrl?: string; spritesheetUrl?: string };
  propAtlases?: { textureUrl?: string; spritesheetUrl?: string }[];
  maps?: Record<string, { file?: string }>;
  npcs?: Record<string, { portraits?: { variants?: Record<string, string> } }>;
  audio?: { bindings?: { tag?: string }[] };
};

/**
 * Declares every group from the MANIFEST.
 *
 * Membership is what the pack says it ships, not what a directory walk happens
 * to find. That distinction is what makes "a required member is missing" a
 * decidable failure rather than a silently smaller group.
 */
export const declareGroups = (manifest: PackManifest): DeclaredGroup[] => {
  const groups: DeclaredGroup[] = [];

  // ── manifest ──────────────────────────────────────────────────────────
  groups.push({
    name: 'manifest',
    members: [{ id: 'manifest.json', path: join(PACK_ROOT, 'manifest.json'), role: 'required' }],
  });

  // ── maps — exactly the maps the manifest declares ─────────────────────
  groups.push({
    name: 'maps',
    members: Object.entries(manifest.maps ?? {}).map(([mapId, entry]) => ({
      id: `maps/${mapId}.json`,
      path: entry.file
        ? resolvePackUrl(`/content-packs/emberwatch/${entry.file}`)
        : join(PACK_ROOT, 'maps', `${mapId}.json`),
      role: 'required' as const,
    })),
  });

  // ── terrain atlas — texture + frame definition, both required ─────────
  // The earlier revision hashed a nonexistent directory here, so the group
  // sealed EMPTY and could not notice a different atlas being promoted.
  const atlasMembers = [];
  if (manifest.atlas?.textureUrl) {
    atlasMembers.push({
      id: 'tilesets/atlas.webp',
      path: resolveGameDataUrl(manifest.atlas.textureUrl),
      role: 'required' as const,
    });
  }
  if (manifest.atlas?.spritesheetUrl) {
    atlasMembers.push({
      id: 'tilesets/atlas.json',
      path: resolveGameDataUrl(manifest.atlas.spritesheetUrl),
      role: 'required' as const,
    });
  }
  groups.push({ name: 'terrainAtlas', members: atlasMembers });

  // ── prop atlases — every page the manifest declares, plus source art ──
  const propMembers = [];
  for (const [index, page] of (manifest.propAtlases ?? []).entries()) {
    if (page.textureUrl) {
      propMembers.push({
        id: `props/page${index}.webp`,
        path: resolveGameDataUrl(page.textureUrl),
        role: 'required' as const,
      });
    }
    if (page.spritesheetUrl) {
      propMembers.push({
        id: `props/page${index}.json`,
        path: resolveGameDataUrl(page.spritesheetUrl),
        role: 'required' as const,
      });
    }
  }
  const propsPagesPath = join(GAME_DATA, 'sprites/tilesets/props.pages.json');
  if (existsSync(propsPagesPath)) {
    propMembers.push({ id: 'props/pages.json', path: propsPagesPath, role: 'optional' as const });
  }
  propMembers.push({
    id: 'props-src',
    path: join(PACK_ROOT, 'props'),
    role: 'optional' as const,
    tree: true,
    extensions: IMAGES,
  });
  groups.push({ name: 'propAtlas', members: propMembers });

  // ── portraits — every variant the manifest binds, scoped to this pack ──
  const portraitMembers = [];
  for (const npc of Object.values(manifest.npcs ?? {})) {
    for (const url of Object.values(npc.portraits?.variants ?? {})) {
      portraitMembers.push({
        id: `portraits/${url.split('/portraits/')[1] ?? url}`,
        path: resolveGameDataUrl(url),
        role: 'required' as const,
      });
    }
  }
  groups.push({ name: 'portraits', members: portraitMembers });

  // ── enemy visuals — authored non-LPC world art ────────────────────────
  groups.push({
    name: 'enemyVisuals',
    members: [
      {
        id: 'enemies',
        path: join(PACK_ROOT, 'enemies'),
        role: 'optional',
        tree: true,
        extensions: IMAGES,
      },
    ],
  });

  // ── audio — every authored cue the manifest binds ─────────────────────
  const audioMembers = [];
  for (const binding of manifest.audio?.bindings ?? []) {
    const tag = binding.tag ?? '';
    const [, , name] = tag.split(':');
    if (name) {
      for (const ext of MEDIA) {
        const candidate = join(PACK_ROOT, 'audio', `${name}${ext}`);
        if (existsSync(candidate)) {
          audioMembers.push({
            id: `audio/${name}${ext}`,
            path: candidate,
            role: 'required' as const,
          });
          break;
        }
      }
    }
  }
  groups.push({ name: 'audio', members: audioMembers });

  return groups;
};

export type SealOutcome =
  | { ok: true; lock: CandidateLock; path: string }
  | { ok: false; errors: readonly string[] };

/** Builds the lock. Pure: no writes, no network. */
export const buildCandidateLock = (): { lock: CandidateLock; missing: readonly string[] } => {
  const manifest = JSON.parse(
    readFileSync(join(PACK_ROOT, 'manifest.json'), 'utf8'),
  ) as PackManifest;
  const declared = declareGroups(manifest);
  const { groups, missingRequired } = buildGroups(declared);

  const rights = runEmberwatchRightsAudit();
  const surface = runSurfaceAudit();
  const surfaceErrors = surface.findings.filter((finding) => finding.severity === 'error');

  const lock = sealCandidate({
    schemaVersion: 'candidate.lock.v2',
    source: {
      commit: git(['rev-parse', 'HEAD']),
      tree: git(['rev-parse', 'HEAD^{tree}']),
    },
    packId: 'emberwatch',
    packVersion: manifest.version ?? '0.0.0',
    sealedAt: new Date().toISOString(),
    manifest: groups.manifest ?? { count: 0, digest: '', artifacts: [] },
    maps: groups.maps ?? { count: 0, digest: '', artifacts: [] },
    terrainAtlas: groups.terrainAtlas ?? { count: 0, digest: '', artifacts: [] },
    propAtlas: groups.propAtlas ?? { count: 0, digest: '', artifacts: [] },
    portraits: groups.portraits ?? { count: 0, digest: '', artifacts: [] },
    enemyVisuals: groups.enemyVisuals ?? { count: 0, digest: '', artifacts: [] },
    audio: groups.audio ?? { count: 0, digest: '', artifacts: [] },
    rights: gate({
      passed: rights.ok,
      report: {
        digest: rights.digest,
        totalEntries: rights.totalEntries,
        totalBlocked: rights.totalBlocked,
        roots: rights.roots,
        releaseContent: rights.releaseContent,
      },
      summary: `${rights.totalEntries} artifacts, ${rights.totalBlocked} blocked`,
    }),
    surface: gate({
      passed: surfaceErrors.length === 0,
      report: { findings: surface.findings, stats: surface.stats },
      summary: `${surface.stats.maps} maps, ${surface.stats.placedProps}/${surface.stats.props} props placed, ${surfaceErrors.length} error(s)`,
    }),
  });

  return {
    lock,
    missing: missingRequired.map((m) => `${m.group}/${m.id} (${m.reason})`),
  };
};

const describe = (lock: CandidateLock): string =>
  [
    `  candidate lock  ${lock.lockHash}`,
    `  source commit   ${lock.source.commit}`,
    `  source tree     ${lock.source.tree}`,
    `  pack            ${lock.packId} ${lock.packVersion}`,
    `  rights          ${lock.rights.passed ? 'PASS' : 'FAIL'} — ${lock.rights.summary}`,
    `  surface         ${lock.surface.passed ? 'PASS' : 'FAIL'} — ${lock.surface.summary}`,
    ...(
      [
        'manifest',
        'maps',
        'terrainAtlas',
        'propAtlas',
        'portraits',
        'enemyVisuals',
        'audio',
      ] as const
    ).map((name) => {
      const g = lock[name];
      return `  ${name.padEnd(15)} ${String(g.count).padStart(3)} file(s)  ${g.digest.slice(0, 12)}…`;
    }),
  ].join('\n');

const lockPath = (lockHash: string): string => join(RELEASE_PLANE, `candidate-${lockHash}.json`);
const latestPath = (): string => join(RELEASE_PLANE, 'candidate.latest.json');

const main = (): void => {
  const verify = process.argv.includes('--verify');
  const show = process.argv.includes('--show');

  if (show) {
    if (!existsSync(latestPath())) {
      console.error(`❌ no sealed candidate at ${latestPath()} — seal one first.`);
      process.exit(1);
    }
    const sealed = JSON.parse(readFileSync(latestPath(), 'utf8')) as CandidateLock;
    console.log(describe(sealed));
    return;
  }

  const dirty = git(['status', '--porcelain']);
  if (dirty.length > 0) {
    console.error(
      '❌ refusing to seal — the working tree has uncommitted changes.\n' +
        '   A candidate must correspond to a committed source state, or nobody else can\n' +
        '   re-derive it. Commit or stash first; there is deliberately no --allow-dirty.',
    );
    for (const line of dirty.split('\n').slice(0, 10)) {
      console.error(`     ${line}`);
    }
    process.exit(1);
  }

  const { lock, missing } = buildCandidateLock();

  if (missing.length > 0) {
    console.error(
      `❌ refusing to seal — ${missing.length} REQUIRED member(s) declared by the manifest are absent:`,
    );
    for (const entry of missing) {
      console.error(`     ${entry}`);
    }
    console.error(
      '   A required member that cannot be hashed would seal a smaller candidate than the\n' +
        '   pack declares, and nothing downstream could notice.',
    );
    process.exit(1);
  }

  if (!Value.Check(CandidateLockSchema, lock)) {
    console.error('❌ the candidate lock failed CandidateLockSchema validation — NOT written.');
    for (const error of [...Value.Errors(CandidateLockSchema, lock)].slice(0, 5)) {
      console.error(`   ${error.instancePath || '/'}: ${error.message}`);
    }
    process.exit(1);
  }

  if (verify) {
    if (!existsSync(latestPath())) {
      console.error(`❌ no sealed candidate at ${latestPath()} — seal one first.`);
      process.exit(1);
    }
    const sealed = JSON.parse(readFileSync(latestPath(), 'utf8')) as CandidateLock;
    const diff = diffCandidateLocks({ approved: sealed, promoting: lock });
    if (diff.identical) {
      console.log(`✅ candidate verified — ${sealed.lockHash}`);
      console.log(describe(lock));
      return;
    }
    console.error('❌ the working tree no longer matches the sealed candidate:');
    if (diff.sourceChanged) {
      console.error(
        `   source: ${sealed.source.commit.slice(0, 10)} → ${lock.source.commit.slice(0, 10)}`,
      );
    }
    for (const changed of diff.changedGroups) {
      console.error(`   ${changed.group}:`);
      for (const id of changed.added) {
        console.error(`     + ${id}`);
      }
      for (const id of changed.removed) {
        console.error(`     - ${id}`);
      }
      for (const id of changed.modified) {
        console.error(`     ~ ${id}`);
      }
    }
    process.exit(1);
  }

  if (!lock.rights.passed || !lock.surface.passed) {
    console.error('❌ refusing to seal — a gate failed:');
    console.error(describe(lock));
    process.exit(1);
  }

  mkdirSync(RELEASE_PLANE, { recursive: true });
  writeFileSync(lockPath(lock.lockHash), `${JSON.stringify(lock, null, 2)}\n`);
  writeFileSync(latestPath(), `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`🔒 candidate sealed — ${lock.lockHash}`);
  console.log(describe(lock));
  console.log(`\n  written to ${lockPath(lock.lockHash)}`);
};

/** Loads the sealed candidate, or throws with a precise reason. */
export const loadSealedCandidate = (): CandidateLock => {
  const path = latestPath();
  if (!existsSync(path)) {
    throw new Error(
      `no sealed candidate at ${path}. Run: bun scripts/src/lib/ops/emberwatch_candidate.ts --seal`,
    );
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as CandidateLock;
  if (!Value.Check(CandidateLockSchema, parsed)) {
    throw new Error(`the sealed candidate at ${path} fails CandidateLockSchema validation`);
  }
  const { lockHash: _ignored, ...rest } = parsed;
  const recomputed = sealCandidate(rest).lockHash;
  if (recomputed !== parsed.lockHash) {
    throw new Error(
      `the sealed candidate at ${path} has been modified: its lockHash is ${parsed.lockHash} but ` +
        `its content re-derives to ${recomputed}`,
    );
  }
  return parsed;
};

if (import.meta.main) {
  main();
}
