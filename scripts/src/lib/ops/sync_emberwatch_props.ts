// scripts/src/lib/ops/sync_emberwatch_props.ts
//
// Upserts the Emberwatch pack's prop table into `content/packs/emberwatch/manifest.json`.
//
// The prop table is the pack's registry, so this script WRITES the registry
// rather than inventing a parallel one: it replaces `manifest.props` with the
// canonical table below and leaves every other manifest section untouched.
//
// Why a table instead of hand edits: the overhaul rebinds props whose artwork
// was a different object's frame (a table drawn with the counter tile, a brazier
// drawn as a barrel) and binds the oversized prop-atlas frames that the previous
// manifest never declared at all (`shrine_arch`, `ward_socket`, `waystation_*`).
// Doing that by hand across ~60 entries drifts; a single derived table cannot.
//
// Frame namespace rules this table obeys:
//   • grid-atlas tiles and prop-atlas frames share ONE flat namespace, so every
//     oversized frame is `prop_*.png` and never collides with a tile frame;
//   • the three frames that already existed as accepted authoring sources
//     (`chair.png`, `shrine_arch.png`, `oak.png`, `birch.png`, `ward_*.png`)
//     keep their names and are reused rather than regenerated.
//
// Run: bun scripts/src/lib/ops/sync_emberwatch_props.ts [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const manifestPath = join(repository, 'content/packs/emberwatch/manifest.json');

/**
 * Frames whose artwork was produced by THIS repository's local image pipeline
 * (sd.cpp + Anima) during the 5.0.0 overhaul. Everything else is accepted art
 * the pack already shipped, whose recorded provenance is `generated:gpt`.
 *
 * The distinction is not cosmetic: provenance is what the publication
 * attribution preflight reads, and stamping local-pipeline art as `gpt` would
 * be a fabricated origin.
 */
const LOCAL_PIPELINE_FRAMES = new Set([
  'prop_barrel.png',
  'prop_brazier.png',
  'prop_cart.png',
  'prop_component.png',
  'prop_gate.png',
  'prop_hearth.png',
  'prop_notice_board.png',
  'prop_oil_pool.png',
  'prop_receipt.png',
  'prop_support.png',
  'prop_ward_socket.png',
]);

type PropDef = {
  name: string;
  frame: string;
  provenance: { source: string };
  anchor?: { x: number; y: number };
  isWalkable: boolean;
  collision?: { type: 'rect'; width: number; height: number };
  environment?: Record<string, unknown>;
};

const combatEnv = (
  durability: number,
  blocksMovement: boolean,
  cover: string,
  affordances?: unknown[],
): Record<string, unknown> => ({
  durability,
  blocksMovement,
  blocksSight: false,
  cover,
  ...(affordances === undefined ? {} : { affordances }),
});

/** Shared affordance blocks, kept identical to the shipped combat definitions. */
const TIP_OVER = [
  {
    affordanceId: 'tip_over',
    name: 'Tip the brazier over',
    actionCost: 'action',
    requirements: [
      { kind: 'adjacent', value: true },
      { kind: 'objectState', value: 'intact' },
    ],
    check: { category: 'athletics', dc: 12, modifierSource: 'athletics' },
    successEffects: [
      { kind: 'setIgnited', objectSelector: 'source', ignited: true },
      {
        kind: 'createSurface',
        surfaceKind: 'fire',
        cellSelector: 'sourceFootprint',
        expiresAfterRound: null,
      },
      {
        kind: 'createSurface',
        surfaceKind: 'fire',
        cellSelector: 'adjacent',
        expiresAfterRound: null,
      },
      { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
    ],
    failureEffects: [{ kind: 'setObjectState', objectSelector: 'source', state: 'broken' }],
  },
];

const IGNITE_OIL = [
  {
    affordanceId: 'ignite_oil',
    name: 'Ignite the oil',
    actionCost: 'quick',
    requirements: [{ kind: 'adjacent', value: true }],
    check: null,
    successEffects: [
      {
        kind: 'createSurface',
        surfaceKind: 'fire',
        cellSelector: 'sourceFootprint',
        expiresAfterRound: null,
      },
      {
        kind: 'createSurface',
        surfaceKind: 'fire',
        cellSelector: 'adjacent',
        expiresAfterRound: null,
      },
      { kind: 'removeSurface', surfaceSelector: 'surfaces:oil' },
    ],
    failureEffects: [],
  },
];

const CUT_SUPPORT = [
  {
    affordanceId: 'cut_support',
    name: 'Cut the support',
    actionCost: 'action',
    requirements: [
      { kind: 'adjacent', value: true },
      { kind: 'objectState', value: 'intact' },
    ],
    check: null,
    successEffects: [
      { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
      { kind: 'dropPayload', objectSelector: 'source', impactZone: 'emberwatch/crate_zone' },
    ],
    failureEffects: [
      { kind: 'dropPayload', objectSelector: 'source', impactZone: 'emberwatch/crate_zone' },
    ],
  },
];

const anchored = (
  name: string,
  frame: string,
  width: number,
  height: number,
  extra: Partial<PropDef> = {},
): PropDef => ({
  name,
  frame,
  provenance: {
    source: LOCAL_PIPELINE_FRAMES.has(frame) ? 'generated:local-sdcpp-anima' : 'generated:gpt',
  },
  anchor: { x: 0.5, y: 1 },
  isWalkable: false,
  collision: { type: 'rect', width, height },
  ...extra,
});

/** The canonical Emberwatch prop table. */
export const EMBERWATCH_PROPS: Record<string, PropDef> = {
  // ── Landmarks ────────────────────────────────────────────────────────────
  ward_tree_landmark: anchored('The Ward Tree', 'ward_large.png', 44, 22),
  ward_grove_a: anchored('Ward Grove (unlit)', 'ward_small_a.png', 28, 16),
  ward_grove_b: anchored('Ward Grove (lit)', 'ward_small_b.png', 28, 16),
  ward_grove_c: anchored('Ward Grove (lit)', 'ward_small_c.png', 28, 16),
  village_well: anchored('Old Stone Well', 'well.png', 22, 14),
  notice_board: anchored('Village Notice Board', 'prop_notice_board.png', 20, 10),
  road_notice: anchored('Road Marker', 'prop_notice_board.png', 20, 10),
  // The gate is a threshold: it must never block the route through it.
  village_gate: {
    name: 'Emberwatch Village Gate',
    frame: 'prop_gate.png',
    provenance: { source: 'generated:local-sdcpp-anima' },
    anchor: { x: 0.5, y: 1 },
    isWalkable: true,
  },

  // ── Woodland ─────────────────────────────────────────────────────────────
  woodland_oak: anchored('Woodland Oak', 'oak.png', 30, 16),
  woodland_oak_2: anchored('Woodland Oak', 'oak.png', 30, 16),
  woodland_oak_3: anchored('Woodland Oak', 'oak.png', 30, 16),
  woodland_oak_4: anchored('Woodland Oak', 'oak.png', 30, 16),
  woodland_birch: anchored('Woodland Birch', 'birch.png', 22, 14),
  woodland_birch_2: anchored('Woodland Birch', 'birch.png', 22, 14),
  shrine_oak: anchored('Woodland Oak', 'oak.png', 30, 16),
  shrine_birch: anchored('Woodland Birch', 'birch.png', 22, 14),

  // ── Containers ───────────────────────────────────────────────────────────
  inn_barrel: anchored('Barrel', 'prop_barrel.png', 20, 20),
  inn_barrel_2: anchored('Barrel', 'prop_barrel.png', 20, 20),
  waystation_barrel: anchored('Waystation Barrel', 'prop_barrel.png', 20, 20),
  shop_barrel: anchored('Barrel', 'prop_barrel.png', 20, 20),
  shop_barrel_2: anchored('Barrel', 'prop_barrel.png', 20, 20),
  shrine_barrel: anchored('Barrel', 'prop_barrel.png', 20, 20),

  inn_crate: anchored('Crate', 'crate.png', 22, 22),
  shop_crate: anchored('Crate', 'crate.png', 22, 22),
  shop_crate_2: anchored('Crate', 'crate.png', 22, 22),
  shop_crate_3: anchored('Crate', 'crate.png', 22, 22),
  waystation_crate: anchored('Crate', 'crate.png', 22, 22),
  waystation_crate_2: anchored('Crate', 'crate.png', 22, 22),
  shrine_crate: anchored('Crate', 'crate.png', 22, 22),

  // ── Counters and furniture ───────────────────────────────────────────────
  shop_counter_l: anchored('Counter', 'counter.png', 28, 18),
  shop_counter_r: anchored('Counter', 'counter.png', 28, 18),
  shop_counter_m: anchored('Counter', 'counter.png', 28, 18),
  inn_counter: anchored('Service Counter', 'counter.png', 28, 18),
  inn_counter_2: anchored('Service Counter', 'counter.png', 28, 18),

  inn_table: anchored('Ale Table', 'table.png', 26, 22, {
    environment: combatEnv(6, true, 'half'),
  }),
  inn_table_2: anchored('Ale Table', 'table.png', 26, 22, {
    environment: combatEnv(6, true, 'half'),
  }),
  inn_table_3: anchored('Ale Table', 'table.png', 26, 22, {
    environment: combatEnv(6, true, 'half'),
  }),

  inn_chair: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_2: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_3: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_4: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_5: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_6: anchored('Chair', 'chair.png', 16, 10),
  shop_chair: anchored('Chair', 'chair.png', 16, 10),

  inn_bed: anchored('Guest Bed', 'bed.png', 30, 22),
  inn_hearth: anchored('Hearth', 'prop_hearth.png', 44, 20),
  inn_shelf: anchored('Storage Shelf', 'bookshelf.png', 24, 14),
  shop_shelf: anchored('Storage Shelf', 'bookshelf.png', 24, 14),
  shop_shelf_2: anchored('Storage Shelf', 'bookshelf.png', 24, 14),
  yard_anvil: anchored('Smith Anvil', 'anvil.png', 24, 16),

  // ── Combat environment objects (affordances preserved) ───────────────────
  inn_brazier: anchored('Brazier', 'prop_brazier.png', 22, 22, {
    environment: combatEnv(4, true, 'none', TIP_OVER),
  }),
  shrine_brazier: anchored('Brazier', 'prop_brazier.png', 22, 22, {
    environment: combatEnv(4, true, 'none'),
  }),
  inn_oil_pool: anchored('Spilled Oil', 'prop_oil_pool.png', 22, 22, {
    isWalkable: true,
    environment: combatEnv(1, false, 'none', IGNITE_OIL),
  }),
  inn_support: anchored('Rotting Support', 'prop_support.png', 22, 22, {
    environment: combatEnv(3, true, 'half', CUT_SUPPORT),
  }),
  waystation_support: anchored('Rotting Support', 'prop_support.png', 22, 22, {
    // Decorative road debris. The `cut_support` affordance belongs to the
    // combat environment object (`inn_support`) alone: an affordance id is a
    // registry key, and declaring it twice makes the encounter environment
    // refuse to compile with "duplicate affordance id".
    environment: combatEnv(3, true, 'half'),
  }),
  inn_hanging_crate: anchored('Hanging Crate', 'crate.png', 22, 22, {
    environment: combatEnv(5, false, 'none'),
  }),

  // ── Evidence objects ─────────────────────────────────────────────────────
  sella_receipt: anchored("Sella's Custody Receipt", 'prop_receipt.png', 20, 10),
  tess_component: anchored('Intact Ward Component', 'prop_component.png', 24, 14),

  // ── Road and shrine ──────────────────────────────────────────────────────
  waystation_cart: anchored('Abandoned Cart', 'prop_cart.png', 40, 24),
  // The arch is a passage: the player must be able to walk through it.
  shrine_arch: {
    name: 'Shrine Arch',
    frame: 'shrine_arch.png',
    provenance: { source: 'generated:gpt' },
    anchor: { x: 0.5, y: 1 },
    isWalkable: true,
  },
  ward_socket: anchored('Ward Socket', 'prop_ward_socket.png', 24, 16),
};

/** Road tree stands: the map builders emit one prop id per tree. */
const ROAD_TREES = 17;
for (let index = 0; index < ROAD_TREES; index += 1) {
  EMBERWATCH_PROPS[`road_oak_${index}`] = anchored('Woodland Oak', 'oak.png', 30, 16);
  EMBERWATCH_PROPS[`road_birch_${index}`] = anchored('Woodland Birch', 'birch.png', 22, 14);
}

const main = (): void => {
  const checkOnly = process.argv.includes('--check');
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as Record<string, unknown>;

  const next = { ...manifest, props: EMBERWATCH_PROPS };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;

  if (checkOnly) {
    const currentProps = JSON.stringify(manifest.props);
    const wantedProps = JSON.stringify(EMBERWATCH_PROPS);
    if (currentProps !== wantedProps) {
      console.error(
        'emberwatch prop table is out of sync — run: bun scripts/src/lib/ops/sync_emberwatch_props.ts',
      );
      process.exit(1);
    }
    console.log('emberwatch prop table is in sync');
    return;
  }

  if (serialized !== raw) {
    writeFileSync(manifestPath, serialized);
  }
  const ids = Object.keys(EMBERWATCH_PROPS);
  const frames = new Set(ids.map((id) => EMBERWATCH_PROPS[id]?.frame));
  console.log(
    `Emberwatch prop table synced: ${ids.length} props over ${frames.size} distinct frames`,
  );
};

main();
