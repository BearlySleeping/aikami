// scripts/src/lib/ops/__tests__/replay_combat_reproduction.test.ts
//
// Exercises the headless reproduction-replay CLI as a subprocess: a valid
// bundle exits 0, invalid JSON is rejected before execution, and a bundle whose
// recorded `expectedFinalHash` does not match the replayed state diverges and
// is accepted only under `--expect-divergence`.
//
// The fixture is the same tiny synthetic combat state the shared reproduction
// test uses, so the CLI is validated against the real production helpers rather
// than a hand-built object shape.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASIC_COMBAT_ABILITIES, BASIC_MELEE_ABILITY_ID } from '@aikami/constants';
import type { CombatCommand, CombatReproduction } from '@aikami/types';
import {
  COMBAT_RULES_VERSION,
  createCombatState,
  hashFinalState,
  replayCombatReproduction,
} from '@aikami/utils';

const CLI_PATH = join(import.meta.dir, '../replay_combat_reproduction.ts');
const TEMP_ROOT = '/tmp/opencode/replay-combat-reproduction';

const PLAYER_ID = 'player-hero';
const GOBLIN_ID = 'emberwatch:goblin-1';

const createInitialState = () =>
  createCombatState({
    encounterId: 'replay-cli-encounter',
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 4242,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    battlefield: { width: 8, height: 8, blockedCells: [] },
    combatants: [
      {
        combatantId: PLAYER_ID,
        name: 'Hero',
        team: 'player',
        position: { x: 1, y: 1 },
        hp: 20,
        maxHp: 20,
        armorClass: 14,
        attackBonus: 4,
        initiative: 20,
        abilityIds: [BASIC_MELEE_ABILITY_ID],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
      },
      {
        combatantId: GOBLIN_ID,
        name: 'Goblin',
        team: 'enemy',
        position: { x: 2, y: 1 },
        hp: 12,
        maxHp: 12,
        armorClass: 12,
        attackBonus: 3,
        initiative: 10,
        abilityIds: [BASIC_MELEE_ABILITY_ID],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
      },
    ],
  });

const TWO_COMMANDS: CombatCommand[] = [
  {
    kind: 'useAbility',
    combatantId: PLAYER_ID,
    abilityId: BASIC_MELEE_ABILITY_ID,
    targetIds: [GOBLIN_ID],
  },
  { kind: 'endTurn', combatantId: PLAYER_ID },
];

const buildReproduction = (overrides: Partial<CombatReproduction> = {}): CombatReproduction => ({
  reproductionVersion: 1,
  rulesVersion: COMBAT_RULES_VERSION,
  scenarioId: 'replay-cli-fixture',
  scenarioVersion: 1,
  encounterRunId: createInitialState().encounterRunId,
  seed: '4242',
  recordedInitialState: createInitialState(),
  commands: TWO_COMMANDS,
  checkpoints: [],
  expectedEvents: [],
  controllerRecords: [],
  complete: true,
  droppedTraceEntries: 0,
  ...overrides,
});

/** The hash of the real replayed final state, so a bundle can be made to match. */
const replayedFinalHash = (): string => {
  const result = replayCombatReproduction(buildReproduction());
  if (result.finalState === null) {
    throw new Error('fixture replay produced no final state');
  }
  return hashFinalState(result.finalState);
};

type CliRun = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const runCli = async (options: {
  readonly bundleText: string;
  readonly expectDivergence?: boolean;
  readonly fileName: string;
}): Promise<CliRun> => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const filePath = join(TEMP_ROOT, options.fileName);
  writeFileSync(filePath, options.bundleText);

  const command = ['bun', 'run', CLI_PATH, filePath];
  if (options.expectDivergence === true) {
    command.push('--expect-divergence');
  }

  const process = Bun.spawn({ cmd: command, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
};

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe('replay_combat_reproduction CLI', () => {
  test('replays a valid bundle and exits 0', async () => {
    const bundle = buildReproduction({ expectedFinalHash: replayedFinalHash() });
    const run = await runCli({ bundleText: JSON.stringify(bundle), fileName: 'valid.json' });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Scenario:          replay-cli-fixture');
    expect(run.stdout).toContain('Commands:          2');
    expect(run.stdout).toContain('Matched expected:  true');
    expect(run.stdout).toContain('Divergence index:  none');
  });

  test('rejects invalid JSON before execution and exits non-zero', async () => {
    const run = await runCli({ bundleText: '{ not json', fileName: 'invalid.json' });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Replay rejected:');
    expect(run.stderr).toContain('not valid JSON');
    expect(run.stdout).not.toContain('Scenario:');
  });

  test('accepts a divergent final hash only with --expect-divergence', async () => {
    const bundle = buildReproduction({ expectedFinalHash: 'cjs1-deadbeef' });

    const withoutFlag = await runCli({
      bundleText: JSON.stringify(bundle),
      fileName: 'divergent-default.json',
    });
    expect(withoutFlag.exitCode).toBe(0);
    expect(withoutFlag.stdout).toContain('Matched expected:  false');

    const withFlag = await runCli({
      bundleText: JSON.stringify(bundle),
      expectDivergence: true,
      fileName: 'divergent-expected.json',
    });
    expect(withFlag.exitCode).toBe(0);
    expect(withFlag.stdout).toContain('Matched expected:  false');
  });

  test('exits non-zero when a divergence is expected but the replay matches', async () => {
    const bundle = buildReproduction({ expectedFinalHash: replayedFinalHash() });
    const run = await runCli({
      bundleText: JSON.stringify(bundle),
      expectDivergence: true,
      fileName: 'matching-expect-divergence.json',
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Expected a divergence');
  });
});
