#!/usr/bin/env bun
/**
 * scripts/src/lib/ops/rebase_emberwatch_brief.ts
 *
 * Rebases the Emberwatch generation brief onto the current source revision and
 * the current pack inventory.
 *
 * The brief is authored data, but its *baseline* and its *coverage* are derived
 * facts: they must name the commit the pack actually ships from and every
 * visual surface the audit found. Hand-editing the JSON drifts — that is
 * exactly how the shipped brief came to be pinned to 4.2.0/`813d056` while the
 * pack had moved to 4.4.0, and how it came to reference preparation profiles
 * that no longer exist under those names.
 *
 * This script:
 *   1. reads the pack manifest, the coverage audit and the current git HEAD;
 *   2. rewrites `baseline` to the exact source revision;
 *   3. rewrites `preparationProfiles` to the SHIPPED profile ids (the previous
 *      keys were symbolic names that resolved to nothing, so every job's
 *      declared profile was decorative);
 *   4. keeps accepted jobs, drops jobs whose provider lane is not implemented
 *      (ambience/SFX have no shipped local model), and adds the visual jobs the
 *      audit found missing.
 *
 * It never touches `content/packs/emberwatch/manifest.json`.
 *
 * Run: bun scripts/src/lib/ops/rebase_emberwatch_brief.ts [--check]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const briefPath = join(repository, 'docs/plans/emberwatch_asset_brief.json');

type Job = {
  id: string;
  phase: 'slice' | 'expansion';
  kind: string;
  action: string;
  subject: string;
  providerPreference: string;
  preparationProfile: string;
  referenceIds: string[];
  candidateLimit: number;
  dependsOn: string[];
  binding: {
    kind: string;
    mapIds: string[];
    targetIds: string[];
    mode: string;
    variant: string | null;
  };
  targetCanvas: [number, number] | null;
  audio: unknown;
  releaseGates: string[];
  status: string;
};

const DARK_GROUND =
  'Render the object isolated and centred on a completely flat solid pure black background that fills every edge; no ground plane, no scenery, no floor, no cast shadow on the background, no lettering, no border. The object must sit on ONE centred footprint and occupy roughly the middle 55% of the frame, centred, with generous empty black background margin on all four sides — the object must never touch or cross the edge of the image, and its lowest point must be directly below its centre of mass so it stands on one centred footprint.';

const STYLE =
  'Warm muted woodland-fantasy palette, soft upper-left light, crisp readable silhouette at native game scale, hand-painted pixel-friendly rendering.';

const prop = (options: {
  id: string;
  phase: 'slice' | 'expansion';
  subject: string;
  mapIds: string[];
  targetIds: string[];
  canvas: [number, number];
  references?: string[];
  bindingKind?: string;
  variant?: string | null;
}): Job => ({
  id: options.id,
  phase: options.phase,
  kind: 'prop',
  action: 'generate_if_missing',
  subject: `${options.subject} ${STYLE} ${DARK_GROUND}`,
  providerPreference: 'local_image_reference',
  preparationProfile: 'prop-full-alpha-ground',
  referenceIds: options.references ?? ['approved_style'],
  candidateLimit: 2,
  dependsOn: [],
  binding: {
    kind: options.bindingKind ?? 'prop',
    mapIds: options.mapIds,
    targetIds: options.targetIds,
    mode: 'proposed_pending_validation',
    variant: options.variant ?? null,
  },
  targetCanvas: options.canvas,
  audio: null,
  releaseGates: ['exact_hash_accepted', 'native_game_review'],
  status: 'planned',
});

const alignedState = (options: {
  id: string;
  subject: string;
  variant: string;
  references: string[];
}): Job => ({
  id: options.id,
  phase: 'expansion',
  kind: 'prop_state',
  action: 'edit',
  subject: options.subject,
  providerPreference: 'local_image_reference',
  // An ending-state edit is still an engine render on a flat ground, so it goes
  // through the same luminance/ground-plane extraction as any other prop. The
  // native-alpha profile only applies to art that ALREADY carries real alpha.
  preparationProfile: 'prop-full-alpha-ground',
  referenceIds: options.references,
  candidateLimit: 2,
  dependsOn: [],
  binding: {
    kind: 'ending_prop',
    mapIds: ['village'],
    targetIds: ['ward_tree_landmark'],
    mode: 'proposed_pending_validation',
    variant: options.variant,
  },
  targetCanvas: null,
  audio: null,
  releaseGates: ['exact_hash_accepted', 'aligned_state_swap', 'authoritative_ending_binding'],
  status: 'planned',
});

const portrait = (options: {
  id: string;
  npcId: string;
  subject: string;
  mapIds: string[];
  referenceId: string;
  variant: string;
  phase: 'slice' | 'expansion';
  bindingKind?: 'npc_portrait' | 'npc_expression';
}): Job => ({
  id: options.id,
  phase: options.phase,
  kind: 'portrait',
  action: 'generate_if_missing',
  subject: options.subject,
  providerPreference: 'local_image_reference',
  preparationProfile: 'portrait-original',
  referenceIds: ['approved_style', options.referenceId],
  candidateLimit: 2,
  dependsOn: [],
  binding: {
    kind: options.bindingKind ?? 'npc_portrait',
    mapIds: options.mapIds,
    targetIds: [options.npcId],
    mode: 'proposed_pending_validation',
    variant: options.variant,
  },
  targetCanvas: [256, 256],
  audio: null,
  releaseGates: ['exact_hash_accepted', 'native_game_review'],
  status: 'planned',
});

const hostileVisual = (options: {
  id: string;
  npcId: string;
  subject: string;
  mapIds: string[];
  phase: 'slice' | 'expansion';
}): Job => ({
  id: options.id,
  phase: options.phase,
  kind: 'prop',
  action: 'generate_if_missing',
  subject: `${options.subject} ${STYLE} ${DARK_GROUND}`,
  providerPreference: 'local_image_reference',
  preparationProfile: 'prop-full-alpha-ground',
  referenceIds: ['approved_style'],
  candidateLimit: 2,
  dependsOn: [],
  binding: {
    kind: 'prop',
    mapIds: options.mapIds,
    targetIds: [options.npcId],
    mode: 'proposed_pending_validation',
    variant: null,
  },
  targetCanvas: [96, 96],
  audio: null,
  releaseGates: ['exact_hash_accepted', 'native_game_review', 'non_humanoid_identity'],
  status: 'planned',
});

// ── Story NPCs that need a portrait, in map order ──────────────────────────
const PORTRAIT_NPCS: { npcId: string; name: string; look: string; mapIds: string[] }[] = [
  {
    npcId: 'village_elder',
    name: 'Elder Thalia',
    look: 'an elderly woman with silver hair pinned back, a deep green wool robe with a bone clasp, weathered kindly face',
    mapIds: ['village'],
  },
  {
    npcId: 'rollo_grasper',
    name: 'Rollo the Grasper',
    look: 'a wiry man in his forties, unkempt dark hair, worn chainmail under a stained leather coat, sharp watchful eyes',
    mapIds: ['inn'],
  },
  {
    npcId: 'merchant',
    name: 'Mara the Merchant',
    look: 'a confident woman with long auburn hair, a sleeveless travelling vest over a linen shirt, coin-belt at the shoulder',
    mapIds: ['merchant_shop'],
  },
  {
    npcId: 'village_guard',
    name: 'Bram the Guard',
    look: 'a broad-shouldered guardsman with short dark hair, chainmail, a patched leather pauldron and a plain iron gorget',
    mapIds: ['village'],
  },
  {
    npcId: 'innkeeper_sella',
    name: 'Sella',
    look: 'a brisk middle-aged woman with hair in a bun, a flour-dusted apron over a rolled-sleeve dress',
    mapIds: ['inn'],
  },
  {
    npcId: 'smith_orra',
    name: 'Orra',
    look: 'a muscular balding woman with soot-smudged cheeks, a heavy leather smith apron and rolled sleeves',
    mapIds: ['village'],
  },
  {
    npcId: 'cartographer_ivo',
    name: 'Ivo',
    look: 'a neat young man with short curly hair, a formal long-sleeve tunic, a rolled chart tucked under one arm',
    mapIds: ['old_road'],
  },
  {
    npcId: 'shrine_keeper_nemi',
    name: 'Nemi',
    look: 'a quiet woman with long straight hair, a plain grey keeper robe with a faded ward sigil stitched at the collar',
    mapIds: ['ruined_shrine'],
  },
  {
    npcId: 'apprentice_tess',
    name: 'Tess',
    look: 'a teenage girl with a bob cut, a short-sleeve apprentice tunic, a brass instrument case strapped across her back',
    mapIds: ['old_road'],
  },
  {
    npcId: 'woodcutter_ada',
    name: 'Ada',
    look: 'a weathered woman with a high ponytail, a cuffed long-sleeve work shirt, an axe resting on one shoulder',
    mapIds: ['old_road'],
  },
];

const main = (): void => {
  const checkOnly = process.argv.includes('--check');
  const manifest = JSON.parse(
    readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
  ) as { version: string; updatedAt: string };
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim();
  const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as Record<string, unknown>;

  // ── 1. Baseline ──────────────────────────────────────────────────────────
  // The brief id names the CAMPAIGN (pack version), not the commit: a run id
  // derived from a commit hash changes every time the branch is committed,
  // which would strand every existing run record and run lock on the next
  // commit. The exact source revision lives in `baseline.commit`, which
  // `--check` deliberately ignores because committing the brief necessarily
  // moves HEAD.
  brief.id = `emberwatch-${manifest.version}`;
  brief.baseline = {
    repository: 'BearlySleeping/aikami',
    commit: head,
    packId: 'emberwatch',
    packVersion: manifest.version,
    reviewedAt: new Date().toISOString().slice(0, 10),
  };

  // ── 2. Preparation profiles — the SHIPPED ids, not symbolic aliases ──────
  // The previous map declared `prop_alpha`/`portrait`/`music_loop`… None of
  // those is a shipped profile, so every job's declaration was decorative and
  // `--preparation-profile` had to be re-stated on every invocation.
  brief.preparationProfiles = {
    'prop-native-alpha':
      'source already carries a real alpha channel; crop/origin preserved, ground rectangle removed, no colour key',
    'prop-full-alpha-ground':
      'opaque render on a flat dark ground; alpha derived by luminance threshold and the ground plane detached by geometry',
    'portrait-original':
      'composed dialogue bust; keeps its own coverage and alpha, no ground-contact requirement',
    'lpc-sheet-native': 'LPC sheets only; nearest-neighbour resample at the 13x21 cell grid',
  };

  // ── 3. Jobs ──────────────────────────────────────────────────────────────
  const jobs: Job[] = [
    // Slice: the vertical slice that proves the whole path end to end.
    prop({
      id: 'well',
      phase: 'slice',
      subject:
        'One old stone village well seen from above and slightly behind: a round mortared fieldstone drum with a timber crossbeam and a rope wound on the windlass, moss at the foot. The whole object must sit on ONE centred footprint — no separate bucket, tool or stone lying beside it.',
      mapIds: ['village'],
      targetIds: ['village_well'],
      canvas: [64, 80],
    }),
    prop({
      id: 'brazier',
      phase: 'slice',
      subject:
        'One inn brazier: a squat iron fire-basket on three short curved legs, standing upright and centred, cold ash and a few dull embers inside, soot streaks on the rim.',
      mapIds: ['inn'],
      targetIds: ['inn_brazier'],
      canvas: [48, 64],
    }),
    portrait({
      id: 'village_elder_neutral',
      npcId: 'village_elder',
      subject: `Dialogue bust of Elder Thalia — ${PORTRAIT_NPCS[0].look}. Neutral attentive expression, soft readable face, plain dark background, no insignia, no scenery, no lettering.`,
      mapIds: ['village'],
      referenceId: 'appearance_village_elder',
      variant: 'neutral',
      phase: 'slice',
    }),
    alignedState({
      id: 'ward_renewed',
      subject:
        'Edit the accepted ward-tree base: restrained amber light follows the existing cracks and branches, returning vitality without changing roots, silhouette, framing or ground contact.',
      variant: 'ward_renewed',
      references: ['approved_style', 'ward_base'],
    }),

    // Expansion: dedicated art for every prop the audit found reusing another
    // object's artwork.
    prop({
      id: 'table',
      phase: 'expansion',
      subject:
        'One inn ale table: a thick plank top on trestle legs, a few ring stains and a clay cup left behind.',
      mapIds: ['inn'],
      targetIds: ['inn_table'],
      canvas: [64, 48],
    }),
    prop({
      id: 'oil_pool',
      phase: 'expansion',
      subject:
        'One spilled-oil surface seen from above: a dark iridescent slick with a few streaks, flat, low and readable as a hazard on a wood floor.',
      mapIds: ['inn'],
      targetIds: ['inn_oil_pool'],
      canvas: [64, 48],
    }),
    prop({
      id: 'rotting_support',
      phase: 'expansion',
      subject:
        'One rotting timber roof support post standing upright and centred: a single vertical square-section beam with splintered grain, a dark rot patch at the foot and a crude iron strap around it.',
      mapIds: ['inn'],
      targetIds: ['inn_support'],
      canvas: [48, 96],
    }),
    prop({
      id: 'custody_receipt',
      phase: 'expansion',
      subject:
        'One parchment custody receipt lying flat on the ground: a single rectangular sheet seen from above with a small broken wax seal in one corner and a few faint lines of illegible writing, no readable words.',
      mapIds: ['inn'],
      targetIds: ['sella_receipt'],
      canvas: [48, 48],
    }),
    prop({
      id: 'ward_component',
      phase: 'expansion',
      subject:
        'One intact ward component: a palm-sized carved stone conduit fitting with a pale quartz core, an iron collar at one end and a hairline seam.',
      mapIds: ['old_road'],
      targetIds: ['tess_component'],
      canvas: [48, 48],
    }),
    prop({
      id: 'broken_cart',
      phase: 'expansion',
      subject:
        'One abandoned broken cart: a two-wheel timber handcart tipped on its side, a shattered axle, spilled planks and a torn canvas cover.',
      mapIds: ['old_road'],
      targetIds: ['waystation_cart'],
      canvas: [96, 80],
    }),
    prop({
      id: 'waystation_barrel',
      phase: 'expansion',
      subject:
        'One weathered road barrel: a water-stained oak cask with rusted iron hoops, one hoop sprung loose, split staves.',
      mapIds: ['old_road'],
      targetIds: ['waystation_barrel'],
      canvas: [48, 64],
    }),
    prop({
      id: 'ward_socket',
      phase: 'expansion',
      subject:
        'One empty ward socket: a low circular stone plinth with a carved ring channel and a dark empty keyway at the centre, cracked along one edge.',
      mapIds: ['ruined_shrine'],
      targetIds: ['ward_socket'],
      canvas: [64, 64],
    }),
    prop({
      id: 'shrine_arch',
      phase: 'expansion',
      subject:
        'One ruined shrine archway: two weathered stone jambs joined by a broken lintel, fallen masonry at the feet, ward grooves cut into the inner faces.',
      mapIds: ['ruined_shrine'],
      targetIds: ['shrine_arch'],
      canvas: [128, 128],
    }),
    prop({
      id: 'notice_board',
      phase: 'expansion',
      subject:
        'One village notice board: a weathered plank panel on two posts under a small shingled hood, a few pinned but illegible scraps.',
      mapIds: ['village'],
      targetIds: ['notice_board'],
      canvas: [64, 64],
    }),
    prop({
      id: 'gate',
      phase: 'expansion',
      subject:
        'One village gate: a timber post-and-rail gateway with an iron-banded lintel and a hanging ward lantern, wide enough to read as a threshold.',
      mapIds: ['village'],
      targetIds: ['village_gate'],
      canvas: [96, 80],
    }),
    prop({
      id: 'barrel',
      phase: 'expansion',
      subject:
        'One inn barrel: a squat oak cask with iron hoops and a wooden tap, resting upright.',
      mapIds: ['inn'],
      targetIds: ['inn_barrel'],
      canvas: [48, 56],
    }),
    prop({
      id: 'crate',
      phase: 'expansion',
      subject:
        'One inn crate: a nailed plank crate with a stencilled but illegible mark and a rope handle.',
      mapIds: ['inn'],
      targetIds: ['inn_crate'],
      canvas: [48, 48],
    }),
    prop({
      id: 'counter',
      phase: 'expansion',
      subject:
        'One shop counter section: a heavy worn plank counter with a moulded front lip, a small brass scale and a folded ledger.',
      mapIds: ['merchant_shop'],
      targetIds: ['shop_counter_l'],
      canvas: [64, 48],
    }),
    prop({
      id: 'chair',
      phase: 'expansion',
      subject: 'One inn chair: a plain spindle-back wooden chair with a woven rush seat.',
      mapIds: ['inn'],
      targetIds: ['inn_chair'],
      canvas: [32, 56],
    }),
    prop({
      id: 'bed',
      phase: 'expansion',
      subject:
        'One inn bed seen from above and behind: a timber frame with a straw mattress, a folded wool blanket and a rolled pillow.',
      mapIds: ['inn'],
      targetIds: ['inn_bed'],
      canvas: [64, 80],
    }),
    prop({
      id: 'hearth',
      phase: 'expansion',
      subject:
        'One inn hearth: a stone fireplace surround with a raised hearthstone, an iron crane and a low cooking fire.',
      mapIds: ['inn'],
      targetIds: ['inn_hearth'],
      canvas: [80, 80],
    }),
    prop({
      id: 'bookshelf',
      phase: 'expansion',
      subject:
        'One tall inn storage shelf: plank shelving holding stacked crocks, folded cloth and a few bound ledgers.',
      mapIds: ['inn'],
      targetIds: ['inn_shelf'],
      canvas: [48, 80],
    }),
    prop({
      id: 'anvil',
      phase: 'expansion',
      subject:
        'One smith anvil on a stump: a horned iron anvil, hammer marks, a pair of tongs leaning against the stump.',
      mapIds: ['village'],
      targetIds: ['yard_anvil'],
      canvas: [64, 56],
    }),
    prop({
      id: 'oak_family',
      phase: 'expansion',
      subject:
        'One mature woodland oak: a broad gnarled trunk with a deep canopy of layered green leaves, roots spreading at the base.',
      mapIds: ['village', 'old_road'],
      targetIds: ['woodland_oak'],
      canvas: [160, 192],
    }),
    prop({
      id: 'birch_family',
      phase: 'expansion',
      subject:
        'One slender birch: a pale bark trunk with dark lenticels and a light airy canopy, a few fallen leaves at the base.',
      mapIds: ['village', 'old_road'],
      targetIds: ['woodland_birch'],
      canvas: [112, 176],
    }),
    prop({
      id: 'ward_grove',
      phase: 'expansion',
      subject:
        'One small ward grove sapling: a young pale-barked tree with a soft amber glow caught in its leaf veins, roots braided around a small ward stone.',
      mapIds: ['village'],
      targetIds: ['ward_grove_a'],
      canvas: [96, 112],
    }),

    // Aligned ending-state swaps.
    alignedState({
      id: 'ward_without_magic',
      subject:
        'Edit the accepted ward-tree base: strip every amber glow and leaf vein light so the tree reads as an ordinary, faintly grey woodland tree; keep roots, silhouette, framing and ground contact identical.',
      variant: 'ward_without_magic',
      references: ['approved_style', 'ward_base'],
    }),
    alignedState({
      id: 'ward_shared',
      subject:
        'Edit the accepted ward-tree base: the amber light spreads outward into a ring of small lit grove saplings at the base; keep roots, silhouette, framing and ground contact identical.',
      variant: 'ward_shared',
      references: ['approved_style', 'ward_base'],
    }),

    // Hostile authored visuals.
    hostileVisual({
      id: 'ash_hound_visual',
      npcId: 'ash_hound',
      subject:
        'One ash hound: a lean four-legged hound the size of a wolf, charcoal-grey hide cracked with glowing ember seams along the ribs, no eyes, smoke curling from the muzzle.',
      mapIds: ['inn', 'old_road'],
      phase: 'expansion',
    }),
    hostileVisual({
      id: 'cinder_thrall_visual',
      npcId: 'cinder_thrall',
      subject:
        'One cinder thrall: a stooped ember-wreathed humanoid husk, bark-and-ash body, a hollow burning chest cavity, long arms hanging low.',
      mapIds: ['old_road', 'ruined_shrine'],
      phase: 'expansion',
    }),
    hostileVisual({
      id: 'ember_warden_visual',
      npcId: 'ember_warden',
      subject:
        'One ember warden: a tall armoured construct of blackened iron plates and cracked ward-stone, a burning core visible between the ribs, a broken horned helm.',
      mapIds: ['ruined_shrine'],
      phase: 'expansion',
    }),
  ];

  // Full portrait set.
  for (const [index, npc] of PORTRAIT_NPCS.entries()) {
    if (npc.npcId === 'village_elder') {
      continue; // already the slice portrait
    }
    jobs.push(
      portrait({
        id: `${npc.npcId}_neutral`,
        npcId: npc.npcId,
        subject: `Dialogue bust of ${npc.name} — ${npc.look}. Neutral attentive expression, soft readable face, plain dark background, no insignia, no scenery, no lettering.`,
        mapIds: npc.mapIds,
        referenceId: `appearance_${npc.npcId}`,
        variant: 'neutral',
        phase: 'expansion',
      }),
    );
    void index;
  }

  // Emotion variants for the two characters whose dialogue carries the most
  // state: the elder's ward concern/relief and Rollo's guarded/relieved arcs.
  jobs.push(
    portrait({
      id: 'village_elder_concerned',
      bindingKind: 'npc_expression' as const,
      npcId: 'village_elder',
      subject:
        'Same character as the accepted Elder Thalia neutral bust — identical identity, clothing and framing; expression changed to grave concern, brow furrowed, mouth set.',
      mapIds: ['village'],
      referenceId: 'portrait_village_elder_neutral',
      variant: 'concerned',
      phase: 'expansion',
    }),
    portrait({
      id: 'village_elder_relieved',
      bindingKind: 'npc_expression' as const,
      npcId: 'village_elder',
      subject:
        'Same character as the accepted Elder Thalia neutral bust — identical identity, clothing and framing; expression changed to quiet relief, softened eyes, faint smile.',
      mapIds: ['village'],
      referenceId: 'portrait_village_elder_neutral',
      variant: 'relieved',
      phase: 'expansion',
    }),
    portrait({
      id: 'rollo_grasper_guarded',
      bindingKind: 'npc_expression' as const,
      npcId: 'rollo_grasper',
      subject:
        'Same character as the accepted Rollo neutral bust — identical identity, clothing and framing; expression changed to guarded suspicion, narrowed eyes, jaw tight.',
      mapIds: ['inn'],
      referenceId: 'portrait_rollo_grasper_neutral',
      variant: 'guarded',
      phase: 'expansion',
    }),
    portrait({
      id: 'rollo_grasper_relieved',
      bindingKind: 'npc_expression' as const,
      npcId: 'rollo_grasper',
      subject:
        'Same character as the accepted Rollo neutral bust — identical identity, clothing and framing; expression changed to wary relief, shoulders dropped, half-smile.',
      mapIds: ['inn'],
      referenceId: 'portrait_rollo_grasper_neutral',
      variant: 'relieved',
      phase: 'expansion',
    }),
  );

  brief.jobs = jobs;

  // ── 4. References — one per job that needs one, all resolvable ───────────
  const references: Record<string, unknown>[] = [
    {
      id: 'approved_style',
      kind: 'approved_art',
      locator: 'content/packs/emberwatch/props/ward_large.png',
      resolution: 'required',
      sha256: null,
      note: "The pack's own accepted ward-landmark art is the approved style reference. Resolved and hashed at plan time.",
    },
    {
      id: 'ward_base',
      kind: 'existing_pack_art',
      locator: 'content/packs/emberwatch/props/ward_large.png',
      resolution: 'required',
      sha256: null,
      note: 'The accepted ward landmark source. An aligned state edit must preserve its canvas, origin and silhouette exactly.',
    },
  ];
  for (const npc of PORTRAIT_NPCS) {
    references.push({
      id: `appearance_${npc.npcId}`,
      kind: 'npc_appearance',
      locator: `content/packs/emberwatch/manifest.json#/npcs/${npc.npcId}`,
      resolution: 'required',
      sha256: null,
      note: `Rendered reference for ${npc.name}; the stable LPC component ids stay unchanged, the portrait must match the named character.`,
    });
  }
  for (const npcId of ['village_elder', 'rollo_grasper']) {
    references.push({
      id: `portrait_${npcId}_neutral`,
      kind: 'approved_art',
      locator: `content/packs/emberwatch/portraits/${npcId}/neutral.png`,
      resolution: 'optional',
      sha256: null,
      note: 'The accepted neutral portrait for this NPC. Optional at plan time (the emotion job can be planned before the neutral is installed) and required before the emotion variant is accepted.',
    });
  }
  brief.references = references;

  // ── 5. Summary ───────────────────────────────────────────────────────────
  const sliceItems = jobs.filter((job) => job.phase === 'slice').length;
  const expansionItems = jobs.length - sliceItems;
  brief.summary = {
    sliceItems,
    expansionItems,
    totalItems: jobs.length,
    maxCandidates: jobs.reduce((sum, job) => sum + job.candidateLimit, 0),
    maxRequestedAudioSecondsPerCandidatePass: 0,
  };

  brief.status = 'proposed';
  brief.notes = [
    `Rebased onto ${head} (pack ${manifest.version}) by scripts/src/lib/ops/rebase_emberwatch_brief.ts.`,
    'The audio lane is deliberately out of scope for this release: no shipped local SFX/ambience model exists (stable_audio_open_1_0_profile is declared but not installed) and the pack-local Emberwatch music is already accepted.',
    'Every prop job renders on a flat dark ground so prop-full-alpha-ground can derive true alpha deterministically; an opaque light-ground render cannot be separated without a colour key, which is not an approved removal.',
    'Enemy visual jobs produce authored non-humanoid art for ash_hound, cinder_thrall and ember_warden; they replace the placeholder humanoid LPC bodies.',
  ];

  const serialized = `${JSON.stringify(brief, null, 2)}\n`;
  const current = readFileSync(briefPath, 'utf8');
  if (checkOnly) {
    if (current !== serialized) {
      console.error(
        'emberwatch brief is not rebased — run: bun scripts/src/lib/ops/rebase_emberwatch_brief.ts',
      );
      process.exit(1);
    }
    console.log('emberwatch brief is rebased and up to date');
    return;
  }
  writeFileSync(briefPath, serialized);
  console.log(
    `Rebased Emberwatch brief onto ${head.slice(0, 9)} (pack ${manifest.version}): ` +
      `${sliceItems} slice / ${expansionItems} expansion jobs, ${references.length} references`,
  );
};

main();
