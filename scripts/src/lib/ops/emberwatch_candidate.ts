// scripts/src/lib/ops/emberwatch_candidate.ts
//
// Seals the Emberwatch release candidate and verifies a sealed one.
//
//   --seal     build the lock from the committed content and write it
//   --verify   re-derive the lock and compare it to the sealed one
//
// Sealing is separate from publishing on purpose: generation, acceptance and
// candidate creation happen once, and staging/production then consume the lock
// instead of rebuilding content differently per environment.
//
// Run: bun scripts/src/lib/ops/emberwatch_candidate.ts --seal
//      bun scripts/src/lib/ops/emberwatch_candidate.ts --verify

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CandidateLock, CandidateLockSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import {
  type CandidateGroupName,
  diffCandidateLocks,
  gate,
  group,
  hashFiles,
  hashTree,
  sealCandidate,
} from '../catalog/candidate_lock.ts';
import { runEmberwatchRightsAudit } from './emberwatch_rights_audit.ts';
import { runSurfaceAudit } from './emberwatch_surface_audit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');

const PACK_ROOT = join(repository, 'content/packs/emberwatch');
const GAME_DATA = join(repository, 'apps/frontend/client/static/game-data');
const LOCK_PATH = join(PACK_ROOT, 'candidate.lock.json');

const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();

/** Builds the lock from the committed content. Pure: no network, no mutation. */
export const buildCandidateLock = (): CandidateLock => {
  const manifest = JSON.parse(readFileSync(join(PACK_ROOT, 'manifest.json'), 'utf8')) as {
    version?: string;
  };

  const images = ['.png', '.webp'] as const;
  const media = ['.webm', '.ogg', '.mp3', '.wav'] as const;

  const groups: Record<CandidateGroupName, ReturnType<typeof group>> = {
    manifest: group(hashTree({ root: PACK_ROOT, extensions: ['.json'] })).count
      ? group(hashFiles([{ id: 'manifest.json', path: join(PACK_ROOT, 'manifest.json') }]))
      : group([]),
    maps: group(
      hashTree({ root: join(PACK_ROOT, 'maps'), idPrefix: 'maps/', extensions: ['.json'] }),
    ),
    // The terrain atlas + its frame definition. They live under
    // `sprites/tilesets/` in the game-data root, which is where the client
    // resolves them — the earlier `tilesets/` guess hashed nothing, so the lock
    // silently carried an empty terrain group and would have promoted a
    // different atlas without noticing.
    terrainAtlas: group(
      hashFiles([
        { id: 'tilesets/atlas.webp', path: join(GAME_DATA, 'sprites/tilesets/atlas.webp') },
        { id: 'tilesets/atlas.json', path: join(GAME_DATA, 'sprites/tilesets/atlas.json') },
      ]),
    ),
    propAtlas: group(
      hashTree({
        root: join(PACK_ROOT, 'props'),
        idPrefix: 'props/',
        extensions: ['.json', ...images],
      }),
    ),
    portraits: group(
      hashTree({ root: join(GAME_DATA, 'portraits'), idPrefix: 'portraits/', extensions: images }),
    ),
    enemyVisuals: group(
      hashTree({ root: join(PACK_ROOT, 'enemies'), idPrefix: 'enemies/', extensions: images }),
    ),
    audio: group(
      hashTree({ root: join(PACK_ROOT, 'audio'), idPrefix: 'audio/', extensions: media }),
    ),
    // Pack-authored JSON (quests, evidence, dialogue) — EXCLUDING the lock
    // itself. The lock lives under the pack root, so hashing the whole tree
    // would make the lock an input to its own hash: seal writes the file, the
    // next seal hashes different content, and `--verify` can never pass.
    packData: group(
      hashTree({ root: PACK_ROOT, idPrefix: 'pack/', extensions: ['.json'] }).filter(
        (artifact) => artifact.id !== 'pack/candidate.lock.json',
      ),
    ),
    assetSeed: group(
      hashFiles([
        { id: 'asset_seed.json', path: join(GAME_DATA, 'asset_seed.json') },
        { id: 'offline_core.json', path: join(GAME_DATA, 'offline_core.json') },
        { id: 'audio_tracks.json', path: join(GAME_DATA, 'audio_tracks.json') },
      ]),
    ),
    credits: group(
      hashFiles([
        {
          id: 'project_licenses.json',
          path: join(repository, 'scripts/src/lib/catalog/project_licenses.json'),
        },
        { id: 'asset_credits.json', path: join(GAME_DATA, 'asset_credits.json') },
      ]),
    ),
  };

  // ── Gates ───────────────────────────────────────────────────────────────
  const rights = runEmberwatchRightsAudit();
  const surface = runSurfaceAudit();
  const surfaceErrors = surface.findings.filter((finding) => finding.severity === 'error');
  const manifestHash = groups.manifest.artifacts[0]?.sha256 ?? '';

  return sealCandidate({
    schemaVersion: 'candidate.lock.v1',
    sourceCommit: git(['rev-parse', 'HEAD']),
    sourceDirty: git(['status', '--porcelain']).length > 0,
    packId: 'emberwatch',
    packVersion: manifest.version ?? '0.0.0',
    sealedAt: new Date().toISOString(),
    ...groups,
    // Release-plane identity is filled by the publish step; a sealed candidate
    // is complete before an index exists, so these start empty.
    catalogRootHash: '',
    catalogShards: {},
    packLockHash: '',
    rights: gate({
      passed: rights.ok,
      digest: rights.digest,
      summary: `${rights.totalEntries} artifacts, ${rights.totalBlocked} blocked`,
    }),
    validation: gate({
      passed: surfaceErrors.length === 0,
      digest: manifestHash,
      summary: `${surface.stats.maps} maps, ${surface.stats.placedProps}/${surface.stats.props} props placed, ${surfaceErrors.length} error(s)`,
    }),
  });
};

const describe = (lock: CandidateLock): string =>
  [
    `  candidate lock  ${lock.lockHash.slice(0, 16)}…`,
    `  source commit   ${lock.sourceCommit}${lock.sourceDirty ? ' (DIRTY)' : ''}`,
    `  pack            ${lock.packId} ${lock.packVersion}`,
    `  rights          ${lock.rights.passed ? 'PASS' : 'FAIL'} — ${lock.rights.summary}`,
    `  validation      ${lock.validation.passed ? 'PASS' : 'FAIL'} — ${lock.validation.summary}`,
    ...(
      [
        'manifest',
        'maps',
        'terrainAtlas',
        'propAtlas',
        'portraits',
        'enemyVisuals',
        'audio',
        'packData',
        'assetSeed',
        'credits',
      ] as const
    ).map((name) => {
      const g = lock[name] as { count: number; digest: string };
      return `  ${name.padEnd(15)} ${String(g.count).padStart(3)} file(s)  ${g.digest.slice(0, 12)}…`;
    }),
  ].join('\n');

const main = (): void => {
  const verify = process.argv.includes('--verify');
  const lock = buildCandidateLock();

  if (!Value.Check(CandidateLockSchema, lock)) {
    const errors = [...Value.Errors(CandidateLockSchema, lock)].slice(0, 5);
    console.error('❌ the candidate lock failed CandidateLockSchema validation — NOT written.');
    for (const error of errors) {
      console.error(`   ${error.instancePath || '/'}: ${error.message}`);
    }
    process.exit(1);
  }

  if (verify) {
    if (!existsSync(LOCK_PATH)) {
      console.error(`❌ no sealed candidate at ${LOCK_PATH} — seal one first.`);
      process.exit(1);
    }
    const sealed = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as CandidateLock;
    const diff = diffCandidateLocks({ approved: sealed, promoting: lock });
    if (diff.identical) {
      console.log(`✅ candidate verified — ${sealed.lockHash}`);
      console.log(describe(lock));
      return;
    }
    console.error('❌ the working tree no longer matches the sealed candidate:');
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
    for (const line of diff.releasePlane) {
      console.error(`   ${line}`);
    }
    process.exit(1);
  }

  if (!lock.rights.passed || !lock.validation.passed) {
    console.error('❌ refusing to seal — a gate failed:');
    console.error(describe(lock));
    process.exit(1);
  }

  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`🔒 candidate sealed — ${lock.lockHash}`);
  console.log(describe(lock));
  console.log(`\n  written to ${LOCK_PATH}`);
};

if (import.meta.main) {
  main();
}
