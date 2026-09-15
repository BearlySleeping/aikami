// scripts/src/lib/ops/benchmark_combat_environment.ts
//
// C-531 AC-8 performance verification: measures the environmental registry
// against the contract's SUPPORTED REFERENCE WORKLOAD and writes a timing
// report that records the machine the numbers came from.
//
// The workload is fixed by the contract:
//   32×32 battlefield, 8 combatants, 32 objects, 64 active surface cells.
//
// Two measurements, both excluding rendering and model time:
//   - preview:  `forecastEnvironmentalCommand` (must consume no RNG/resources)
//   - resolve:  `resolveCombatCommand` for one `interactWithObject` command
//
// A target without a recorded environment does not count as measured, so the
// report always carries CPU/OS/runtime.
//
// Run: bun scripts/src/lib/ops/benchmark_combat_environment.ts [--samples 2000]

import { cpus, platform, release, arch } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BattlefieldObject,
  CombatEnvironmentBundle,
  CombatState,
  SurfaceCell,
} from '@aikami/types';
import { buildEnvironmentFromContent } from '@aikami/utils';
import {
  COMBAT_RULES_VERSION,
  createCombatState,
  forecastEnvironmentalCommand,
  resolveCombatCommand,
} from '@aikami/utils';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const REPORT_PATH = join(repository, 'docs/verification/C-531-timing.md');

/** The contract's supported reference workload. */
const WORKLOAD = {
  battlefieldWidth: 32,
  battlefieldHeight: 32,
  combatants: 8,
  objects: 32,
  surfaceCells: 64,
} as const;

const PREVIEW_TARGET_P95_MS = 16;
const RESOLVE_TARGET_P95_MS = 10;

const samplesArg = process.argv.indexOf('--samples');
const SAMPLES =
  samplesArg === -1 ? 2000 : Number.parseInt(process.argv[samplesArg + 1] ?? '2000', 10);

const percentile = (sorted: number[], fraction: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
};

const summarize = (durations: number[]) => {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Fixture — the reference workload
// ---------------------------------------------------------------------------

const buildFixture = (): { state: CombatState; objectId: string; affordanceId: string } => {
  const props: Record<string, Record<string, unknown>> = {
    'bench/barrel': {
      name: 'Barrel',
      frame: 'barrel.png',
      isWalkable: false,
      environment: {
        durability: 4,
        cover: 'half',
        affordances: [
          {
            affordanceId: 'tip_over',
            name: 'Tip over',
            actionCost: 'action',
            requirements: [{ kind: 'adjacent', value: true }],
            check: { category: 'athletics', dc: 12, modifierSource: 'athletics' },
            successEffects: [
              { kind: 'setIgnited', objectSelector: 'source', ignited: true },
              {
                kind: 'createSurface',
                surfaceKind: 'fire',
                cellSelector: 'sourceFootprint',
                expiresAfterRound: null,
              },
              { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
            ],
            failureEffects: [],
          },
        ],
      },
    },
    'bench/oil': {
      name: 'Oil',
      frame: 'oil.png',
      isWalkable: true,
      environment: { durability: 1, affordances: [] },
    },
  };

  const objects = Array.from({ length: WORKLOAD.objects }, (_, index) => ({
    objectId: `bench/barrel-${String(index).padStart(2, '0')}`,
    propId: 'bench/barrel',
    cell: { x: 4 + (index % 8), y: 4 + Math.floor(index / 8) },
  }));

  const built = buildEnvironmentFromContent({
    // biome-ignore lint/suspicious/noExplicitAny: benchmark fixture only
    props: props as any,
    objects,
    impactZones: {},
  });
  if (!built.ok) {
    throw new Error(`benchmark fixture invalid: ${built.issues.join('; ')}`);
  }

  // 64 active surface cells, spread so they do not all share one hazard family
  // tick — the fixture measures the resolver, not the hazard cadence.
  const surfaces: SurfaceCell[] = Array.from({ length: WORKLOAD.surfaceCells }, (_, index) => ({
    surfaceId: `surface:oil:${index}:0:none`,
    kind: 'oil',
    cell: { x: index % WORKLOAD.battlefieldWidth, y: 30 },
    expiresAfterRound: null,
    sourceObjectId: null,
  }));

  const environment = { ...built.state, surfaces };
  const combatants = Array.from({ length: WORKLOAD.combatants }, (_, index) => ({
    combatantId: `bench/actor-${index}`,
    name: `Actor ${index}`,
    team: (index === 0 ? 'player' : 'enemy') as 'player' | 'enemy',
    position: { x: 3, y: 3 + index },
    hp: 20,
    maxHp: 20,
    armorClass: 12,
    attackBonus: 3,
    initiative: 20 - index,
    abilityIds: [],
    budget: {
      movementRemaining: 6,
      actionAvailable: true,
      quickActionAvailable: true,
      reactionAvailable: true,
    },
    downed: false,
    defeated: false,
    checkModifiers: { athletics: 3 },
  }));

  const state = createCombatState({
    encounterId: 'c531-benchmark',
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 424242,
    combatants,
    abilityCatalog: {},
    battlefield: {
      width: WORKLOAD.battlefieldWidth,
      height: WORKLOAD.battlefieldHeight,
      blockedCells: [],
    },
    environment,
    environmentBundle: built.bundle as CombatEnvironmentBundle,
  });

  // The acting combatant stands next to the first object so the authored
  // `adjacent` requirement is satisfied.
  const first = (Object.values(environment.objects) as BattlefieldObject[]).sort((a, b) =>
    a.objectId < b.objectId ? -1 : 1,
  )[0];
  state.combatants['bench/actor-0'].position = { x: first.position.x - 1, y: first.position.y };

  return { state, objectId: first.objectId, affordanceId: 'tip_over' };
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const main = (): void => {
  const fixture = buildFixture();
  const command = {
    kind: 'interactWithObject' as const,
    combatantId: 'bench/actor-0',
    objectId: fixture.objectId,
    affordanceId: fixture.affordanceId,
    targetObjectId: null,
  };

  // Warm-up: the first call pays module/IC initialization, not steady state.
  for (let index = 0; index < 200; index++) {
    forecastEnvironmentalCommand({
      state: fixture.state,
      actorId: 'bench/actor-0',
      command,
    });
    resolveCombatCommand({ state: fixture.state, command });
  }

  const previewDurations: number[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    const started = performance.now();
    forecastEnvironmentalCommand({
      state: fixture.state,
      actorId: 'bench/actor-0',
      command,
    });
    previewDurations.push(performance.now() - started);
  }

  const resolveDurations: number[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    // Resolved against a FRESH clone each time so the measurement includes the
    // full transactional path (clone, validate, roll, apply).
    const state = structuredClone(fixture.state);
    state.combatants['bench/actor-0'].budget.actionAvailable = true;
    const started = performance.now();
    resolveCombatCommand({ state, command });
    resolveDurations.push(performance.now() - started);
  }

  const preview = summarize(previewDurations);
  const resolve = summarize(resolveDurations);
  const cpu = cpus()[0];
  const generatedAt = new Date().toISOString();

  const previewPass = preview.p95 <= PREVIEW_TARGET_P95_MS;
  const resolvePass = resolve.p95 <= RESOLVE_TARGET_P95_MS;

  const report = `# C-531 environmental timing report

Generated by \`scripts/src/lib/ops/benchmark_combat_environment.ts\`.
Regenerate with \`bun scripts/src/lib/ops/benchmark_combat_environment.ts\`.

## Recorded environment

| Field | Value |
| --- | --- |
| Generated at | ${generatedAt} |
| CPU | ${cpu?.model ?? 'unknown'} (${cpus().length} logical cores) |
| OS | ${platform()} ${release()} (${arch()}) |
| Runtime | Bun ${Bun.version} |
| Samples | ${SAMPLES} (after 200 warm-up iterations) |

A timing target without a recorded environment does not count as measured, so
the table above is part of the result.

## Supported reference workload

| Dimension | Value |
| --- | --- |
| Battlefield | ${WORKLOAD.battlefieldWidth}×${WORKLOAD.battlefieldHeight} |
| Combatants | ${WORKLOAD.combatants} |
| Authored objects | ${WORKLOAD.objects} |
| Active surface cells | ${WORKLOAD.surfaceCells} |

## Results (milliseconds, excluding rendering and model time)

| Measurement | Target (p95) | p50 | p95 | max | Result |
| --- | --- | --- | --- | --- | --- |
| Environmental preview (\`forecastEnvironmentalCommand\`) | ≤ ${PREVIEW_TARGET_P95_MS} ms | ${preview.p50.toFixed(3)} | ${preview.p95.toFixed(3)} | ${preview.max.toFixed(3)} | ${previewPass ? 'PASS' : 'FAIL'} |
| Kernel command resolution (\`resolveCombatCommand\`) | ≤ ${RESOLVE_TARGET_P95_MS} ms | ${resolve.p50.toFixed(3)} | ${resolve.p95.toFixed(3)} | ${resolve.max.toFixed(3)} | ${resolvePass ? 'PASS' : 'FAIL'} |

Both measurements exclude rendering and model time: no animation, no network
call and no model call sits inside either path. The preview consumes no
resources and never advances the RNG — that is asserted by
\`packages/shared/utils/src/lib/rules/__tests__/combat_environment.test.ts\`
("forecasts an environmental command without advancing the RNG").
`;

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, report);

  process.stdout.write(report);
  process.stdout.write(`\nReport written to ${REPORT_PATH}\n`);
  if (!previewPass || !resolvePass) {
    process.exitCode = 1;
  }
};

main();
