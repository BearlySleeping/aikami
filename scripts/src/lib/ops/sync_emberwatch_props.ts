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
  'prop_well.png',
  // C-529 follow-up: the six former legacy-grid furniture frames, replaced by
  // standalone local-pipeline art in the polish pass.
  'prop_anvil.png',
  'prop_bed.png',
  'prop_bookshelf.png',
  'prop_counter.png',
  'prop_crate.png',
  'prop_table.png',
]);

type PropRenderSize = { width?: number; height?: number };

type PropShadow =
  | {
      kind: 'ellipse';
      width: number;
      height: number;
      offsetX?: number;
      offsetY?: number;
      opacity?: number;
    }
  | { kind: 'none' };

type PropPresentation = { renderSize?: PropRenderSize; shadow?: PropShadow };

/**
 * Per-FRAME logical world size and contact shadow (C-496/C-529).
 *
 * Texture packing size is a build detail and must never dictate the world
 * footprint: these are the AUTHORED native sizes the accepted art is meant to
 * occupy in the world. Sizes preserve the accepted source's aspect ratio (a
 * guard test derives them from the PNG headers), so this is a preparation /
 * render-size correction, not a re-art.
 *
 * The values are bounded by the asset brief's native canvas for each prop
 * (`docs/plans/emberwatch_asset_brief.json` `targetCanvas`) and by the accepted
 * source dimensions — see `docs/guides/emberwatch-release.md` for the table.
 *
 * Shadow follows "subtle contact grounding" for standing objects, and `none`
 * for trees, buildings/arches, and flat decals whose accepted art already
 * reads as grounded. `ellipse` sizes are the visual footprint only — collision
 * remains gameplay-authoritative and is declared separately.
 */
const PROP_PRESENTATION: Record<string, PropPresentation> = {
  // ── Landmarks ──
  'prop_well.png': {
    renderSize: { width: 64, height: 80 },
    shadow: { kind: 'ellipse', width: 46, height: 18, opacity: 0.22 },
  },
  'prop_notice_board.png': {
    renderSize: { width: 64, height: 53 },
    shadow: { kind: 'ellipse', width: 36, height: 10, opacity: 0.2 },
  },
  // The gate and the shrine arch are passages/buildings — their own art
  // carries the grounding; a contact shadow under a threshold reads as a hole.
  'prop_gate.png': { renderSize: { width: 96, height: 68 }, shadow: { kind: 'none' } },
  'shrine_arch.png': { renderSize: { width: 160, height: 160 }, shadow: { kind: 'none' } },

  // ── Woodland ──
  'oak.png': { renderSize: { width: 126, height: 160 }, shadow: { kind: 'none' } },
  'birch.png': { renderSize: { width: 70, height: 160 }, shadow: { kind: 'none' } },
  'ward_large.png': { renderSize: { width: 192, height: 152 }, shadow: { kind: 'none' } },
  'ward_small_a.png': { renderSize: { width: 96, height: 96 }, shadow: { kind: 'none' } },
  'ward_small_b.png': { renderSize: { width: 96, height: 96 }, shadow: { kind: 'none' } },
  'ward_small_c.png': { renderSize: { width: 96, height: 96 }, shadow: { kind: 'none' } },

  // ── Containers ──
  'prop_barrel.png': {
    renderSize: { width: 48, height: 35 },
    shadow: { kind: 'ellipse', width: 30, height: 12, opacity: 0.22 },
  },
  // C-529 follow-up: the six former legacy-grid furniture frames now have
  // accepted standalone art. Sizes preserve each prepared source's aspect
  // ratio (the trim bbox), so no prop is stretched.
  'prop_crate.png': {
    renderSize: { width: 40, height: 29 },
    shadow: { kind: 'ellipse', width: 28, height: 10, opacity: 0.2 },
  },
  'prop_table.png': {
    renderSize: { width: 56, height: 40 },
    shadow: { kind: 'ellipse', width: 44, height: 12, opacity: 0.2 },
  },
  'prop_bed.png': {
    renderSize: { width: 56, height: 54 },
    shadow: { kind: 'ellipse', width: 42, height: 12, opacity: 0.2 },
  },
  'prop_bookshelf.png': {
    renderSize: { width: 34, height: 58 },
    shadow: { kind: 'ellipse', width: 24, height: 9, opacity: 0.2 },
  },
  'prop_counter.png': {
    renderSize: { width: 64, height: 36 },
    shadow: { kind: 'ellipse', width: 52, height: 11, opacity: 0.2 },
  },
  'prop_anvil.png': {
    renderSize: { width: 46, height: 31 },
    shadow: { kind: 'ellipse', width: 30, height: 10, opacity: 0.2 },
  },
  'chair.png': {
    renderSize: { width: 26, height: 48 },
    shadow: { kind: 'ellipse', width: 16, height: 6, opacity: 0.2 },
  },

  // ── Combat environment objects ──
  'prop_brazier.png': {
    renderSize: { width: 64, height: 56 },
    shadow: { kind: 'ellipse', width: 34, height: 14, opacity: 0.22 },
  },
  'prop_oil_pool.png': {
    renderSize: { width: 64, height: 49 },
    // A spilled pool IS its own grounding: no cast shadow.
    shadow: { kind: 'none' },
  },
  'prop_support.png': {
    renderSize: { width: 20, height: 96 },
    shadow: { kind: 'ellipse', width: 18, height: 9, opacity: 0.2 },
  },
  'prop_hearth.png': {
    renderSize: { width: 78, height: 80 },
    shadow: { kind: 'ellipse', width: 58, height: 16, opacity: 0.2 },
  },

  // ── Evidence / road ──
  'prop_receipt.png': {
    renderSize: { width: 48, height: 31 },
    shadow: { kind: 'ellipse', width: 24, height: 7, opacity: 0.18 },
  },
  'prop_component.png': {
    renderSize: { width: 39, height: 48 },
    shadow: { kind: 'ellipse', width: 20, height: 8, opacity: 0.18 },
  },
  'prop_cart.png': {
    renderSize: { width: 96, height: 57 },
    shadow: { kind: 'ellipse', width: 72, height: 20, opacity: 0.2 },
  },
  'prop_ward_socket.png': {
    renderSize: { width: 64, height: 49 },
    shadow: { kind: 'ellipse', width: 40, height: 14, opacity: 0.2 },
  },
};

type PropDef = {
  name: string;
  frame: string;
  provenance: { source: string };
  anchor?: { x: number; y: number };
  isWalkable: boolean;
  collision?: { type: 'rect'; width: number; height: number };
  environment?: Record<string, unknown>;
  renderSize?: PropRenderSize;
  shadow?: PropShadow;
  /** C-545: light source exempt from the day/night ambient tint. */
  emissive?: boolean;
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
  // Per-frame logical world size + contact shadow apply to every prop that
  // reuses the frame, so a shared frame can never render at two sizes.
  ...(PROP_PRESENTATION[frame] ?? {}),
  ...extra,
});

/** The canonical Emberwatch prop table. */
export const EMBERWATCH_PROPS: Record<string, PropDef> = {
  // ── Landmarks ────────────────────────────────────────────────────────────
  ward_tree_landmark: anchored('The Ward Tree', 'ward_large.png', 44, 22),
  ward_grove_a: anchored('Ward Grove (unlit)', 'ward_small_a.png', 28, 16),
  ward_grove_b: anchored('Ward Grove (lit)', 'ward_small_b.png', 28, 16),
  ward_grove_c: anchored('Ward Grove (lit)', 'ward_small_c.png', 28, 16),
  village_well: anchored('Old Stone Well', 'prop_well.png', 22, 14),
  notice_board: anchored('Village Notice Board', 'prop_notice_board.png', 20, 10),
  road_notice: anchored('Road Marker', 'prop_notice_board.png', 20, 10),
  // The gate is a threshold: it must never block the route through it.
  village_gate: {
    name: 'Emberwatch Village Gate',
    frame: 'prop_gate.png',
    provenance: { source: 'generated:local-sdcpp-anima' },
    anchor: { x: 0.5, y: 1 },
    isWalkable: true,
    ...(PROP_PRESENTATION['prop_gate.png'] ?? {}),
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

  inn_crate: anchored('Crate', 'prop_crate.png', 22, 22),
  shop_crate: anchored('Crate', 'prop_crate.png', 22, 22),
  shop_crate_2: anchored('Crate', 'prop_crate.png', 22, 22),
  shop_crate_3: anchored('Crate', 'prop_crate.png', 22, 22),
  waystation_crate: anchored('Crate', 'prop_crate.png', 22, 22),
  waystation_crate_2: anchored('Crate', 'prop_crate.png', 22, 22),
  shrine_crate: anchored('Crate', 'prop_crate.png', 22, 22),

  // ── Counters and furniture ───────────────────────────────────────────────
  shop_counter_l: anchored('Counter', 'prop_counter.png', 28, 18),
  shop_counter_r: anchored('Counter', 'prop_counter.png', 28, 18),
  shop_counter_m: anchored('Counter', 'prop_counter.png', 28, 18),
  inn_counter: anchored('Service Counter', 'prop_counter.png', 28, 18),
  inn_counter_2: anchored('Service Counter', 'prop_counter.png', 28, 18),

  inn_table: anchored('Ale Table', 'prop_table.png', 26, 22, {
    environment: combatEnv(6, true, 'half'),
  }),
  inn_table_2: anchored('Ale Table', 'prop_table.png', 26, 22, {
    environment: combatEnv(6, true, 'half'),
  }),
  inn_table_3: anchored('Ale Table', 'prop_table.png', 26, 22, {
    environment: combatEnv(6, true, 'half'),
  }),

  inn_chair: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_2: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_3: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_4: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_5: anchored('Chair', 'chair.png', 16, 10),
  inn_chair_6: anchored('Chair', 'chair.png', 16, 10),
  shop_chair: anchored('Chair', 'chair.png', 16, 10),

  inn_bed: anchored('Guest Bed', 'prop_bed.png', 30, 22),
  // C-545: the hearth and both braziers are lit fire sources — they keep
  // their authored warmth at night instead of taking the ambient multiplier.
  inn_hearth: anchored('Hearth', 'prop_hearth.png', 44, 20, { emissive: true }),
  inn_shelf: anchored('Storage Shelf', 'prop_bookshelf.png', 24, 14),
  shop_shelf: anchored('Storage Shelf', 'prop_bookshelf.png', 24, 14),
  shop_shelf_2: anchored('Storage Shelf', 'prop_bookshelf.png', 24, 14),
  yard_anvil: anchored('Smith Anvil', 'prop_anvil.png', 24, 16),

  // ── Combat environment objects (affordances preserved) ───────────────────
  // C-545: braziers are lit fire sources — exempt from the ambient tint.
  inn_brazier: anchored('Brazier', 'prop_brazier.png', 22, 22, {
    emissive: true,
    environment: combatEnv(4, true, 'none', TIP_OVER),
  }),
  shrine_brazier: anchored('Brazier', 'prop_brazier.png', 22, 22, {
    emissive: true,
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
  inn_hanging_crate: anchored('Hanging Crate', 'prop_crate.png', 22, 22, {
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
    ...(PROP_PRESENTATION['shrine_arch.png'] ?? {}),
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
