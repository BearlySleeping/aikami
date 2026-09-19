// scripts/src/lib/ops/install_emberwatch_portraits.ts
//
// Installs the pack's ACCEPTED portraits into the runtime game-data plane and
// binds them in the pack manifest.
//
// Authoring source:  content/packs/emberwatch/portraits/<npcId>/<variant>.png
// Runtime artifact:  apps/frontend/client/static/game-data/portraits/emberwatch/<npcId>/<variant>.png
// Manifest binding:  manifest.npcs[<npcId>].portraits.variants[<variant>] = <runtime url>
//
// Why the copy exists: the pack manifest references its art by the published
// runtime path (the same convention `atlas.textureUrl` and `propAtlases[].textureUrl`
// already use), and the catalog scan publishes the game-data root under the
// `sprites`/`portraits` categories. The authoring source stays in the pack so
// the pack remains self-contained and reviewable.
//
// Only portraits that exist as authoring sources are bound. An NPC with no
// portrait keeps the pre-portrait behaviour (no bust) rather than being pointed
// at a file that was never produced.
//
// Run: bun scripts/src/lib/ops/install_emberwatch_portraits.ts [--check]

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const packRoot = join(repository, 'content/packs/emberwatch');
const sourceRoot = join(packRoot, 'portraits');
const runtimeRoot = join(repository, 'apps/frontend/client/static/game-data/portraits/emberwatch');
const manifestPath = join(packRoot, 'manifest.json');

/** Runtime URL a pack portrait is published under. */
const runtimeUrl = (npcId: string, variant: string): string =>
  `/game-data/portraits/emberwatch/${npcId}/${variant}.png`;

/** The variants the pack schema models, in binding order. */
const VARIANTS = ['neutral', 'concerned', 'relieved', 'guarded', 'hostile'] as const;

type NpcEntry = { portraits?: { variants: Record<string, string> } };

const main = (): void => {
  const checkOnly = process.argv.includes('--check');
  if (!existsSync(sourceRoot)) {
    console.log(
      'install_emberwatch_portraits: no authoring portraits directory — nothing to install',
    );
    return;
  }

  const currentManifest = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(currentManifest) as {
    npcs: Record<string, NpcEntry>;
  };

  const installed: { npcId: string; variant: string; source: string }[] = [];
  for (const npcId of readdirSync(sourceRoot).sort()) {
    const npcDir = join(sourceRoot, npcId);
    if (!existsSync(npcDir)) {
      continue;
    }
    const variants: Record<string, string> = {};
    for (const variant of VARIANTS) {
      const source = join(npcDir, `${variant}.png`);
      if (!existsSync(source)) {
        continue;
      }
      variants[variant] = runtimeUrl(npcId, variant);
      installed.push({ npcId, variant, source });
      if (!checkOnly) {
        const destination = join(runtimeRoot, npcId, `${variant}.png`);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(source, destination);
      }
    }
    const npc = manifest.npcs[npcId];
    if (npc === undefined) {
      continue;
    }
    if (Object.keys(variants).length === 0) {
      // No portrait authored: the binding must be absent, never an empty block
      // the schema would reject (variants.neutral is required).
      delete npc.portraits;
      continue;
    }
    if (variants.neutral === undefined) {
      throw new Error(
        `install_emberwatch_portraits: ${npcId} has no neutral portrait — neutral is required by the schema`,
      );
    }
    npc.portraits = { variants };
  }

  const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  if (checkOnly) {
    if (currentManifest !== serializedManifest) {
      throw new Error(
        'install_emberwatch_portraits: manifest.json differs from the computed portrait bindings',
      );
    }
  } else {
    writeFileSync(manifestPath, serializedManifest);
  }

  console.log(
    `install_emberwatch_portraits: ${installed.length} portrait(s) across ${
      new Set(installed.map((entry) => entry.npcId)).size
    } NPC(s)${checkOnly ? ' (check only)' : ''}`,
  );
  for (const entry of installed) {
    console.log(`  ${entry.npcId}/${entry.variant}`);
  }
};

main();
