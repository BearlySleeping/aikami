// apps/frontend/client/src/lib/views/dev/autonomous_sandbox_view_model.test.ts
//
// C-248: Autonomous NPC behavior sandbox ViewModel tests.
//
// Exercises the ViewModel through feature-owned capability fixtures — no
// `$services` barrel and no global service-registry mock.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { NpcSchedule } from '@aikami/types';
import type { ScheduleEditorViewModelInterface } from '../settings/autonomous/schedule_editor_view_model.svelte';
import {
  type AutonomousMessageCapabilities,
  type AutonomousScheduleCapabilities,
  createAutonomousSandboxViewModel,
  type IdleCapabilities,
} from './autonomous_sandbox_view_model.svelte';

// The test preload only polyfills `$derived`; the sandbox uses `$derived.by`.
const derived = globalThis as unknown as {
  $derived?: { by?: (fn: () => unknown) => unknown };
};
if (derived.$derived && !derived.$derived.by) {
  derived.$derived.by = (fn: () => unknown) => fn();
}

const createIdle = (overrides: Partial<IdleCapabilities> = {}): IdleCapabilities => ({
  idleDurationMs: 0,
  isDnd: false,
  isIdle: mock(() => false),
  resetIdle: mock(() => {}),
  setDnd: mock(() => {}),
  ...overrides,
});

const createPoller = (
  overrides: Partial<AutonomousMessageCapabilities> = {},
): AutonomousMessageCapabilities => ({
  isRunning: false,
  isPaused: false,
  start: mock(() => {}),
  stop: mock(() => {}),
  pause: mock(() => {}),
  resume: mock(() => {}),
  ...overrides,
});

const createSchedules = (
  overrides: Partial<AutonomousScheduleCapabilities> = {},
): AutonomousScheduleCapabilities => ({
  getSchedule: mock(async (): Promise<NpcSchedule> => ({ generated: false }) as NpcSchedule),
  setSchedule: mock(async () => {}),
  ...overrides,
});

const createScheduleEditor = (): ScheduleEditorViewModelInterface =>
  ({ open: mock(async () => {}) }) as unknown as ScheduleEditorViewModelInterface;

const createViewModel = (
  options: {
    idle?: IdleCapabilities;
    autonomousMessages?: AutonomousMessageCapabilities;
    schedules?: AutonomousScheduleCapabilities;
    scheduleEditor?: ScheduleEditorViewModelInterface;
    randomId?: () => string;
  } = {},
) =>
  createAutonomousSandboxViewModel({
    className: 'AutonomousSandboxViewModel',
    idle: options.idle ?? createIdle(),
    autonomousMessages: options.autonomousMessages ?? createPoller(),
    schedules: options.schedules ?? createSchedules(),
    scheduleEditor: options.scheduleEditor ?? createScheduleEditor(),
    randomId: options.randomId,
  });

describe('AutonomousSandboxViewModel — initial state', () => {
  test('exposes the injected capability state', () => {
    const viewModel = createViewModel({
      idle: createIdle({ idleDurationMs: 4200, isDnd: true }),
    });

    expect(viewModel.idleDurationMs).toBe(4200);
    expect(viewModel.isDnd).toBe(true);
    expect(viewModel.isPollerRunning).toBe(false);
    expect(viewModel.isPollerPaused).toBe(false);
    expect(viewModel.mockNpcIds).toEqual([
      'mock-npc-blacksmith',
      'mock-npc-rogue',
      'mock-npc-bard',
    ]);
  });

  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});

describe('AutonomousSandboxViewModel — idle controls', () => {
  test('resetIdle delegates and logs', () => {
    const resetIdle = mock(() => {});
    const viewModel = createViewModel({ idle: createIdle({ resetIdle }) });

    viewModel.resetIdle();

    expect(resetIdle).toHaveBeenCalledTimes(1);
    expect(viewModel.testLog.some((entry) => entry.includes('Idle reset to 0'))).toBe(true);
  });

  test('toggleDnd flips the injected DND state', () => {
    const setDnd = mock(() => {});
    const viewModel = createViewModel({ idle: createIdle({ isDnd: false, setDnd }) });

    viewModel.toggleDnd();

    expect(setDnd).toHaveBeenCalledWith(true);
  });
});

describe('AutonomousSandboxViewModel — poller controls', () => {
  test('start/stop/pause/resume delegate to the poller capability', () => {
    const start = mock(() => {});
    const stop = mock(() => {});
    const pause = mock(() => {});
    const resume = mock(() => {});
    const viewModel = createViewModel({
      autonomousMessages: createPoller({ start, stop, pause, resume }),
    });

    viewModel.startPoller();
    viewModel.stopPoller();
    viewModel.pausePoller();
    viewModel.resumePoller();

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

describe('AutonomousSandboxViewModel — schedules', () => {
  test('initialize seeds a schedule for every mock NPC', async () => {
    const setSchedule = mock(async () => {});
    const viewModel = createViewModel({ schedules: createSchedules({ setSchedule }) });

    await viewModel.initialize();

    expect(setSchedule).toHaveBeenCalledTimes(3);
    expect(viewModel.testLog.some((entry) => entry.includes('Seeded 3 mock NPC schedules'))).toBe(
      true,
    );
  });

  test('addMockNpc persists a default schedule with an injected id', async () => {
    const setSchedule = mock(async () => {});
    const viewModel = createViewModel({
      schedules: createSchedules({ setSchedule }),
      randomId: () => 'abcd1234-efgh-5678',
    });

    await viewModel.addMockNpc({ name: 'Tester', personality: 'curious', talkativeness: 0.5 });

    expect(setSchedule).toHaveBeenCalledWith(
      'mock-abcd1234',
      expect.objectContaining({ npcId: 'mock-abcd1234', talkativeness: 0.5 }),
    );
  });

  test('openScheduleEditor reads the schedule and opens the editor sub-VM', async () => {
    const getSchedule = mock(
      async (): Promise<NpcSchedule> => ({ generated: false }) as NpcSchedule,
    );
    const open = mock(async () => {});
    const scheduleEditor = { open } as unknown as ScheduleEditorViewModelInterface;
    const viewModel = createViewModel({
      schedules: createSchedules({ getSchedule }),
      scheduleEditor,
    });

    await viewModel.openScheduleEditor({ npcId: 'mock-npc-blacksmith' });

    expect(getSchedule).toHaveBeenCalledWith('mock-npc-blacksmith');
    expect(open).toHaveBeenCalledWith({
      npcId: 'mock-npc-blacksmith',
      npcName: 'Grimm Forgebeard',
    });
  });
});

describe('AutonomousSandboxViewModel — log', () => {
  test('clearLog empties the test log', () => {
    const viewModel = createViewModel();

    viewModel.setCurrentTimeOverride({ day: 1, hour: 8 });
    expect(viewModel.testLog.length).toBeGreaterThan(0);

    viewModel.clearLog();
    expect(viewModel.testLog).toEqual([]);
  });
});
