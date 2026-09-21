// scripts/src/lib/ops/emberwatch_locked_identity.ts
//
// Stable-identity guard for the five Emberwatch maps.
//
// A visual-polish pass may move a landmark, reshape a square, swap a prop's
// frame or nudge an NPC — none of which should touch a save reference, a quest
// objective, a transition edge or a dialogue key. This module extracts exactly
// those LOCKED identities from the generated maps + manifest and compares them
// to a committed golden. Any drift is a hard failure until a human updates the
// golden deliberately (`--update`), so an ordinary polish edit cannot silently
// rewire gameplay.
//
// Locked (compared):
//   map ids · transition ids + targetMap + targetSpawnId · spawn ids · NPC ids
//   · prop ids · dialogue keys · quest ids · evidence ids · affordance ids.
//
// Polishable (deliberately NOT compared): coordinates, widths, terrain, frames,
// render size, anchor, shadow, prop display names.
//
// Run: bun scripts/src/lib/ops/emberwatch_locked_identity.ts [--check|--update|--json]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const packRoot = join(repository, 'content/packs/emberwatch');
const mapsDir = join(packRoot, 'maps');
const GOLDEN_PATH = join(here, 'emberwatch_locked_ids.golden.json');

type Property = { name: string; value: unknown };
type MapObject = { id?: number; type?: string; properties?: Property[] };
type MapLayer = { name?: string; objects?: MapObject[] };
type MapJson = { layers?: MapLayer[] };

/** A transition's locked identity: its id and the edge it forms. */
export type LockedTransition = {
  id: number;
  targetMap: string;
  targetSpawnId: string;
};

export type LockedMapIdentity = {
  spawnIds: string[];
  npcIds: string[];
  propIds: string[];
  dialogueKeys: string[];
  transitions: LockedTransition[];
};

export type LockedIdentities = {
  maps: Record<string, LockedMapIdentity>;
  manifest: {
    mapIds: string[];
    npcIds: string[];
    questIds: string[];
    evidenceIds: string[];
    affordanceIds: string[];
  };
};

/** Drift in one locked collection. */
export type IdentityDrift = {
  path: string;
  /** Identities present in the golden but gone now. */
  removed: string[];
  /** Identities absent from the golden but present now. */
  added: string[];
  /** Identities whose locked edge changed (transitions). */
  changed: string[];
};

export type LockedIdentityResult = {
  current: LockedIdentities;
  ok: boolean;
  drift: IdentityDrift[];
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const propValue = (properties: Property[] | undefined, name: string): unknown =>
  (properties ?? []).find((candidate) => candidate.name === name)?.value;

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

const mapFiles = (): string[] =>
  readdirSync(mapsDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

/** Records one map object's locked identity onto the accumulator. */
const recordObjectIdentity = (identity: LockedMapIdentity, object: MapObject): void => {
  if (object.type === 'spawn') {
    pushString(identity.spawnIds, propValue(object.properties, 'spawnId'));
  } else if (object.type === 'npc') {
    pushString(identity.npcIds, propValue(object.properties, 'npcId'));
    pushString(identity.dialogueKeys, propValue(object.properties, 'dialogueKey'));
  } else if (object.type === 'prop') {
    pushString(identity.propIds, propValue(object.properties, 'propId'));
  } else if (object.type === 'transition') {
    const transition = transitionIdentity(object);
    if (transition) {
      identity.transitions.push(transition);
    }
  }
};

const pushString = (target: string[], value: unknown): void => {
  if (typeof value === 'string') {
    target.push(value);
  }
};

const transitionIdentity = (object: MapObject): LockedTransition | undefined => {
  const targetMap = propValue(object.properties, 'targetMap');
  if (typeof targetMap !== 'string') {
    return undefined;
  }
  const targetSpawnId = propValue(object.properties, 'targetSpawnId');
  return {
    id: Number(object.id ?? 0),
    targetMap,
    targetSpawnId: typeof targetSpawnId === 'string' ? targetSpawnId : '',
  };
};

/** Collects one map's locked identities from its committed JSON. */
const readMapIdentity = (mapId: string): LockedMapIdentity => {
  const map = readJson<MapJson>(join(mapsDir, `${mapId}.json`));
  const identity: LockedMapIdentity = {
    spawnIds: [],
    npcIds: [],
    propIds: [],
    dialogueKeys: [],
    transitions: [],
  };
  for (const layer of map.layers ?? []) {
    for (const object of layer.objects ?? []) {
      recordObjectIdentity(identity, object);
    }
  }
  identity.spawnIds = sortedUnique(identity.spawnIds);
  identity.npcIds = sortedUnique(identity.npcIds);
  identity.propIds = sortedUnique(identity.propIds);
  identity.dialogueKeys = sortedUnique(identity.dialogueKeys);
  identity.transitions.sort((a, b) => a.id - b.id);
  return identity;
};

/** The canonical locked-identity snapshot of the current pack. */
export const extractLockedIdentities = (): LockedIdentities => {
  const maps: Record<string, LockedMapIdentity> = {};
  for (const file of mapFiles()) {
    maps[file.slice(0, -'.json'.length)] = readMapIdentity(file.slice(0, -'.json'.length));
  }
  const manifest = readJson<{
    maps?: Record<string, unknown>;
    npcs?: Record<string, unknown>;
    quests?: Record<string, unknown>;
    evidence?: Array<{ id?: string }>;
    props?: Record<string, { environment?: { affordances?: Array<{ affordanceId?: string }> } }>;
  }>(join(packRoot, 'manifest.json'));

  const affordanceIds: string[] = [];
  for (const def of Object.values(manifest.props ?? {})) {
    for (const affordance of def.environment?.affordances ?? []) {
      if (typeof affordance.affordanceId === 'string') {
        affordanceIds.push(affordance.affordanceId);
      }
    }
  }

  return {
    maps,
    manifest: {
      mapIds: sortedUnique(Object.keys(manifest.maps ?? {})),
      npcIds: sortedUnique(Object.keys(manifest.npcs ?? {})),
      questIds: sortedUnique(Object.keys(manifest.quests ?? {})),
      evidenceIds: sortedUnique(
        (manifest.evidence ?? []).map((entry) => entry.id ?? '').filter((id) => id.length > 0),
      ),
      affordanceIds: sortedUnique(affordanceIds),
    },
  };
};

/** String identities used for a list diff; transitions render as `id→target`. */
const stringsOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
    return value.map((entry) => {
      const t = entry as LockedTransition;
      return `${t.id}→${t.targetMap}#${t.targetSpawnId}`;
    });
  }
  return value.map((entry) => String(entry));
};

/** Diffs two locked-identity snapshots, returning every drift path. */
export const diffLockedIdentities = (
  golden: LockedIdentities,
  current: LockedIdentities,
): IdentityDrift[] => {
  const drift: IdentityDrift[] = [];
  const compare = (path: string, before: unknown, after: unknown): void => {
    const beforeSet = new Set(stringsOf(before));
    const afterSet = new Set(stringsOf(after));
    const removed = [...beforeSet].filter((entry) => !afterSet.has(entry)).sort();
    const added = [...afterSet].filter((entry) => !beforeSet.has(entry)).sort();
    if (removed.length > 0 || added.length > 0) {
      drift.push({ path, removed, added, changed: [] });
    }
  };

  const mapIds = sortedUnique([...Object.keys(golden.maps), ...Object.keys(current.maps)]);
  for (const mapId of mapIds) {
    const before = golden.maps[mapId];
    const after = current.maps[mapId];
    if (!before || !after) {
      drift.push({
        path: `maps.${mapId}`,
        removed: before ? ['<map>'] : [],
        added: after ? ['<map>'] : [],
        changed: [],
      });
      continue;
    }
    compare(`maps.${mapId}.spawnIds`, before.spawnIds, after.spawnIds);
    compare(`maps.${mapId}.npcIds`, before.npcIds, after.npcIds);
    compare(`maps.${mapId}.propIds`, before.propIds, after.propIds);
    compare(`maps.${mapId}.dialogueKeys`, before.dialogueKeys, after.dialogueKeys);
    compare(`maps.${mapId}.transitions`, before.transitions, after.transitions);
  }

  compare('manifest.mapIds', golden.manifest.mapIds, current.manifest.mapIds);
  compare('manifest.npcIds', golden.manifest.npcIds, current.manifest.npcIds);
  compare('manifest.questIds', golden.manifest.questIds, current.manifest.questIds);
  compare('manifest.evidenceIds', golden.manifest.evidenceIds, current.manifest.evidenceIds);
  compare('manifest.affordanceIds', golden.manifest.affordanceIds, current.manifest.affordanceIds);

  return drift;
};

/** Reads the committed golden, or `undefined` when it has not been generated. */
export const readLockedIdentityGolden = (): LockedIdentities | undefined => {
  if (!existsSync(GOLDEN_PATH)) {
    return undefined;
  }
  return readJson<LockedIdentities>(GOLDEN_PATH);
};

/** Compares the current pack against the committed golden. */
export const checkLockedIdentities = (): LockedIdentityResult => {
  const current = extractLockedIdentities();
  const golden = readLockedIdentityGolden();
  if (!golden) {
    return {
      current,
      ok: false,
      drift: [{ path: '<golden>', removed: [], added: ['missing golden file'], changed: [] }],
    };
  }
  const drift = diffLockedIdentities(golden, current);
  return { current, ok: drift.length === 0, drift };
};

/** Serializes the golden deterministically. */
export const serializeLockedIdentities = (identities: LockedIdentities): string =>
  `${JSON.stringify(identities, null, 2)}\n`;

const printDrift = (drift: readonly IdentityDrift[]): void => {
  for (const entry of drift) {
    console.error(`  ${entry.path}`);
    for (const id of entry.removed) {
      console.error(`    - ${id}`);
    }
    for (const id of entry.added) {
      console.error(`    + ${id}`);
    }
  }
};

const main = (): void => {
  const update = process.argv.includes('--update');
  const json = process.argv.includes('--json');
  const current = extractLockedIdentities();

  if (update) {
    writeFileSync(GOLDEN_PATH, serializeLockedIdentities(current));
    console.log(`emberwatch locked identities golden updated: ${GOLDEN_PATH}`);
    return;
  }

  const result = checkLockedIdentities();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  if (result.ok) {
    console.log('✅ emberwatch locked identities unchanged');
    return;
  }
  console.error(
    '❌ emberwatch locked identities drifted — a save/quest/transition reference changed:',
  );
  printDrift(result.drift);
  console.error(
    '   If this change is intended gameplay work, update the golden deliberately:\n' +
      '     bun run emberwatch:locked-ids --update',
  );
  process.exit(1);
};

if (import.meta.main) {
  main();
}
