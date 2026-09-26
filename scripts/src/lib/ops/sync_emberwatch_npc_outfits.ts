// scripts/src/lib/ops/sync_emberwatch_npc_outfits.ts
//
// Writes the Emberwatch pack's NPC OUTFITS into `content/packs/emberwatch/manifest.json`.
//
// Why this is a derived table and not hand edits:
//
//   • Bram the Guard shipped with NO appearance at all, so the renderer fell
//     back to the default bare body. A guard with no armour, no sword and no
//     shield is a content omission, not a styling choice.
//   • Ada, Thalia, Sella, Nemi and Tess named `legs/pants_female` /
//     `legs/pants_teen`. Those asset ids exist in the committed legacy catalog
//     snapshot (so `validate:content` passed) but were NEVER published, so the
//     layer resolved to a sheet that does not exist and silently drew nothing.
//     The build-time validator cannot see that class of miss; a table that only
//     names ids which are actually published can.
//   • Several NPCs had no role-defining garment at all — no hat, no apron, no
//     weapon — so a village of identically dressed figures.
//
// Body-type suffix convention in this LPC collection: the slender/female body
// uses the `_thin` sheets for legs and feet, while torso garments carry an
// explicit `_female` suffix and heads carry `human/female`. Naming a
// non-existent `*_female` leg sheet is exactly the silent-miss failure above.
//
// SLOT MODEL: the six base slots (body, hair, head, torso, legs, feet) are
// positional — they are the entries of a six-element serialized array — and
// therefore resolved into `appearanceLayers`. Everything an outfit may add on
// top (hat, shield, weapon, cape, …) is an EXTRA slot: it is drawn as an
// additional layer beside the base six and ordered by the renderer's own depth
// table, never folded into that array.
//
// The per-entity layer budget is 8, and the base six already spend six of
// them, so an outfit gets exactly TWO extras. That is why Bram carries a sword
// and a shield (the two things that make him read as a guard) and not also a
// helm and pauldrons: those would need a tenth layer and the composer would
// drop them without any error. The rejected kit is recorded below rather than
// quietly deleted, so raising the budget later is a one-line change here.
//
// Only layers that exist in the published catalog are named here, so an outfit
// always draws. Run: bun scripts/src/lib/ops/sync_emberwatch_npc_outfits.ts [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const manifestPath = join(repository, 'content/packs/emberwatch/manifest.json');

/**
 * Canonical component order.
 *
 * Cosmetic only — `layer_order.ts` decides draw depth — but a stable order
 * keeps the serialized manifest byte-identical across runs, which is what makes
 * a rebuild a no-op instead of an endless diff.
 */
const SLOT_ORDER = [
  'body',
  'hair',
  'head',
  'torso',
  'legs',
  'feet',
  'cape',
  'shoulders',
  'hat',
  'accessory',
  'accessories',
  'headAccessories',
  'arms',
  'belt',
  'quiver',
  'weapon',
  'shield',
] as const;

/**
 * Kit that would round out an outfit but does not fit the per-entity layer
 * budget alongside the base six.
 *
 * Recorded, not written. Bram's helm and pauldrons are the obvious next
 * additions: they need a tenth and eleventh layer, so authoring them today
 * would produce a character the composer silently truncates. Raise
 * `LPC_MAX_LAYERS` (and the composer's uniform block) first, then move them
 * into {@link EMBERWATCH_NPC_OUTFITS}.
 */
export const EMBERWATCH_OVER_BUDGET_KIT: readonly {
  readonly npcId: string;
  readonly layers: readonly OutfitLayer[];
}[] = [
  {
    npcId: 'village_guard',
    layers: [
      { slot: 'shoulders', assetId: 'shoulders/pauldrons_male' },
      { slot: 'hat', assetId: 'hat/helmet/barbuta_male' },
    ],
  },
];

/** One authored garment/hair layer: a slot and a published LPC asset id. */
type OutfitLayer = { readonly slot: string; readonly assetId: string };

/** One NPC's complete outfit. */
type NpcOutfit = { readonly npcId: string; readonly layers: readonly OutfitLayer[] };

const outfit = (npcId: string, layers: readonly OutfitLayer[]): NpcOutfit => ({ npcId, layers });

/**
 * The authored cast.
 *
 * Every human NPC gets a complete body/hair/head so nothing falls back to the
 * bare default, and a role-defining garment. The three hostile creatures are
 * deliberately absent: they draw as ONE authored still image (`visual.kind ===
 * 'static'`), so LPC layers would never be composed for them.
 */
export const EMBERWATCH_NPC_OUTFITS: readonly NpcOutfit[] = [
  // Bram the Guard — the village's only defender. Leather armour over plate leg
  // and foot pieces, plus the two extras that make him read as a guard from
  // across the map: a longsword and a wooden heater shield. His helm and
  // pauldrons are in {@link EMBERWATCH_OVER_BUDGET_KIT}.
  outfit('village_guard', [
    { slot: 'body', assetId: 'body/bodies_male' },
    { slot: 'hair', assetId: 'hair/plain_adult' },
    { slot: 'head', assetId: 'head/heads/human_male' },
    { slot: 'torso', assetId: 'torso/armour/leather_male' },
    { slot: 'legs', assetId: 'legs/armour/plate_male' },
    { slot: 'feet', assetId: 'feet/armour/plate_male' },
    { slot: 'weapon', assetId: 'weapon/sword/longsword' },
    { slot: 'shield', assetId: 'shield/heater/original/wood_fg' },
  ]),
  // Ada the Woodcutter — long-sleeved work shirt, trousers and boots, and a war axe.
  // It is the one published axe in the collection; there is no wood-cutting
  // axe sheet, so this is the closest thing the library can honestly draw.
  outfit('woodcutter_ada', [
    { slot: 'body', assetId: 'body/bodies_female' },
    { slot: 'hair', assetId: 'hair/high_ponytail/fg_adult' },
    { slot: 'head', assetId: 'head/heads/human_female' },
    { slot: 'torso', assetId: 'torso/clothes/longsleeve/longsleeve2_female' },
    { slot: 'legs', assetId: 'legs/pants_thin' },
    { slot: 'feet', assetId: 'feet/boots/basic_thin' },
    { slot: 'weapon', assetId: 'weapon/blunt/waraxe' },
  ]),
  // Elder Thalia — long robe over a straight skirt.
  outfit('village_elder', [
    { slot: 'body', assetId: 'body/bodies_female' },
    { slot: 'hair', assetId: 'hair/bangs_adult' },
    { slot: 'head', assetId: 'head/heads/human/female_elderly' },
    { slot: 'torso', assetId: 'torso/clothes/robe_female' },
    { slot: 'legs', assetId: 'legs/skirts/straight_thin' },
    { slot: 'feet', assetId: 'feet/shoes/basic_thin' },
  ]),
  // Nemi, shrine keeper — same robe silhouette as the elder, no hat: the shrine
  // is served barefoot-simple, and a bonnet would fight the keeper's iconography.
  outfit('shrine_keeper_nemi', [
    { slot: 'body', assetId: 'body/bodies_female' },
    { slot: 'hair', assetId: 'hair/long_adult' },
    { slot: 'head', assetId: 'head/heads/human_female' },
    { slot: 'torso', assetId: 'torso/clothes/robe_female' },
    { slot: 'legs', assetId: 'legs/skirts/straight_thin' },
    { slot: 'feet', assetId: 'feet/shoes/basic_thin' },
  ]),
  // Sella, innkeeper — apron over plain clothes.
  outfit('innkeeper_sella', [
    { slot: 'body', assetId: 'body/bodies_female' },
    { slot: 'hair', assetId: 'hair/bangs_bun_adult' },
    { slot: 'head', assetId: 'head/heads/human_female' },
    { slot: 'torso', assetId: 'torso/aprons/apron_female' },
    { slot: 'legs', assetId: 'legs/pants_thin' },
    { slot: 'feet', assetId: 'feet/shoes/basic_thin' },
  ]),
  // Tess, apprentice — short sleeves and boots, the lightest work outfit in
  // the village so she reads as the youngest of the cast.
  outfit('apprentice_tess', [
    { slot: 'body', assetId: 'body/bodies_teen' },
    { slot: 'hair', assetId: 'hair/bob_adult' },
    { slot: 'head', assetId: 'head/heads/human_female' },
    { slot: 'torso', assetId: 'torso/clothes/shortsleeve/shortsleeve_female' },
    { slot: 'legs', assetId: 'legs/pants_thin' },
    { slot: 'feet', assetId: 'feet/boots/basic_thin' },
  ]),
  // Orra, smith — muscular build under a smith's apron.
  outfit('smith_orra', [
    { slot: 'body', assetId: 'body/bodies_muscular' },
    { slot: 'hair', assetId: 'hair/balding_adult' },
    { slot: 'head', assetId: 'head/heads/human_male' },
    { slot: 'torso', assetId: 'torso/aprons/apron_male' },
    { slot: 'legs', assetId: 'legs/pants_muscular' },
    { slot: 'feet', assetId: 'feet/boots/basic_male' },
  ]),
  // Mara, merchant — travelling clothes, no armour: she is a trader, not a fighter.
  outfit('merchant', [
    { slot: 'body', assetId: 'body/bodies_male' },
    { slot: 'hair', assetId: 'hair/long_adult' },
    { slot: 'head', assetId: 'head/heads/human_male' },
    { slot: 'torso', assetId: 'torso/clothes/vest_male' },
    { slot: 'legs', assetId: 'legs/pants_male' },
    { slot: 'feet', assetId: 'feet/shoes/basic_male' },
  ]),
  // Ivo, cartographer — formal shirt, the only "dressed up" villager.
  outfit('cartographer_ivo', [
    { slot: 'body', assetId: 'body/bodies_male' },
    { slot: 'hair', assetId: 'hair/curly_short_adult' },
    { slot: 'head', assetId: 'head/heads/human_male' },
    { slot: 'torso', assetId: 'torso/clothes/longsleeve/formal_male' },
    { slot: 'legs', assetId: 'legs/pants_male' },
    { slot: 'feet', assetId: 'feet/shoes/basic_male' },
  ]),
  // Rollo the Grasper — hooded leather, the one suspicious silhouette in the
  // village; leather armour over a shirt reads as travelling gear.
  outfit('rollo_grasper', [
    { slot: 'body', assetId: 'body/bodies_male' },
    { slot: 'hair', assetId: 'hair/plain_adult' },
    { slot: 'head', assetId: 'head/heads/human_male' },
    { slot: 'torso', assetId: 'torso/armour/leather_male' },
    { slot: 'legs', assetId: 'legs/pants_male' },
    { slot: 'feet', assetId: 'feet/boots/basic_male' },
  ]),
];

/** The manifest subset this script reads and writes. */
type NpcEntry = {
  appearance?: { formatVersion: number; components?: unknown[] };
  appearanceLayers?: number[];
  visual?: { kind: string };
} & Record<string, unknown>;

type ManifestJson = { npcs?: Record<string, NpcEntry | undefined> } & Record<string, unknown>;

/** Sorts layers into {@link SLOT_ORDER} so serialization is deterministic. */
const ordered = (layers: readonly OutfitLayer[]): OutfitLayer[] =>
  [...layers].sort((left, right) => {
    const leftIndex = SLOT_ORDER.indexOf(left.slot as (typeof SLOT_ORDER)[number]);
    const rightIndex = SLOT_ORDER.indexOf(right.slot as (typeof SLOT_ORDER)[number]);
    // An unknown slot sorts last, then alphabetically, so a new slot is still
    // deterministic rather than dependent on table order.
    const leftRank = leftIndex === -1 ? SLOT_ORDER.length : leftIndex;
    const rightRank = rightIndex === -1 ? SLOT_ORDER.length : rightIndex;
    return leftRank === rightRank ? left.slot.localeCompare(right.slot) : leftRank - rightRank;
  });

/** The named appearance object written for one NPC. */
export const appearanceFor = (
  layers: readonly OutfitLayer[],
): {
  formatVersion: 1;
  components: { slot: string; assetId: string; layerRole: 'front' }[];
} => ({
  formatVersion: 1,
  components: ordered(layers).map((layer) => ({ ...layer, layerRole: 'front' as const })),
});

/** NPCs that draw through LPC layers, i.e. everything not a single authored image. */
export const lpcDrawnNpcIds = (npcs: Record<string, NpcEntry | undefined>): string[] =>
  Object.entries(npcs)
    .filter(([, npc]) => npc !== undefined && npc.visual?.kind !== 'static')
    .map(([npcId]) => npcId)
    .sort();

const main = (): void => {
  const checkOnly = process.argv.includes('--check');
  const current = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(current) as ManifestJson;
  const npcs = manifest.npcs ?? {};

  for (const { npcId, layers } of EMBERWATCH_NPC_OUTFITS) {
    const npc = npcs[npcId];
    if (npc === undefined) {
      throw new Error(`sync_emberwatch_npc_outfits: the pack declares no NPC "${npcId}"`);
    }
    if (npc.visual?.kind === 'static') {
      throw new Error(
        `sync_emberwatch_npc_outfits: "${npcId}" draws as one authored image; LPC layers would never compose`,
      );
    }
    npc.appearance = appearanceFor(layers);
    // The legacy numeric array is a SECOND representation of the same outfit.
    // Keeping it would reintroduce exactly the drift the validator compares
    // for, and it is not read at runtime: the named appearance is preferred.
    delete npc.appearanceLayers;
  }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (checkOnly) {
    if (current !== serialized) {
      throw new Error(
        'sync_emberwatch_npc_outfits: manifest.json differs from the authored NPC outfits',
      );
    }
  } else {
    writeFileSync(manifestPath, serialized);
  }

  const worn = EMBERWATCH_NPC_OUTFITS.reduce((sum, entry) => sum + entry.layers.length, 0);
  console.log(
    `sync_emberwatch_npc_outfits: ${EMBERWATCH_NPC_OUTFITS.length} NPC(s), ${worn} layer(s)` +
      `${checkOnly ? ' (check only)' : ''}`,
  );
  for (const { npcId, layers } of EMBERWATCH_NPC_OUTFITS) {
    console.log(`  ${npcId}: ${layers.map((layer) => layer.slot).join(', ')}`);
  }
};

if (import.meta.main) {
  main();
}
