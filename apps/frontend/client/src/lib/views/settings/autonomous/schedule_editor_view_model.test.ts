// apps/frontend/client/src/lib/views/settings/autonomous/schedule_editor_view_model.test.ts
//
// C-248: Schedule editor ViewModel tests.
//
// This suite exercises the ViewModel through feature-owned capability fixtures —
// no global `$services` barrel mock and no dependency on the test_preload mock
// inventory. Each test constructs exactly the schedule and generation
// capabilities it needs.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { AvailabilityStatus, DaySchedule, NpcSchedule } from '@aikami/types';
import {
  createScheduleEditorViewModel,
  type NpcScheduleCapabilities,
  type ScheduleGenerationCapabilities,
} from './schedule_editor_view_model.svelte';

// ── Fixtures ─────────────────────────────────────────────────────────────

const createDay = (day: number, status: AvailabilityStatus = 'online'): DaySchedule => ({
  day,
  hours: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    status,
    activity: 'Available',
  })),
});

const createSchedule = (overrides: Partial<NpcSchedule> = {}): NpcSchedule => ({
  npcId: 'npc-1',
  days: Array.from({ length: 7 }, (_, day) => createDay(day)),
  autonomousEnabled: true,
  talkativeness: 0.5,
  cooldownMinutes: 15,
  generated: false,
  updatedAt: '2026-09-04T00:00:00.000Z',
  ...overrides,
});

const createScheduleCapabilities = (
  overrides: Partial<NpcScheduleCapabilities> = {},
): NpcScheduleCapabilities => ({
  getSchedule: async () => createSchedule(),
  setSchedule: async () => {},
  ...overrides,
});

const createGenerationCapabilities = (
  overrides: Partial<ScheduleGenerationCapabilities> = {},
): ScheduleGenerationCapabilities => ({
  extractStructure: async () => ({}),
  ...overrides,
});

const createViewModel = (
  options: {
    schedules?: NpcScheduleCapabilities;
    generation?: ScheduleGenerationCapabilities;
  } = {},
) =>
  createScheduleEditorViewModel({
    className: 'ScheduleEditorViewModel',
    schedules: options.schedules ?? createScheduleCapabilities(),
    generation: options.generation ?? createGenerationCapabilities(),
  });

// ── Tests ────────────────────────────────────────────────────────────────

describe('ScheduleEditorViewModel — loading', () => {
  test('open loads the NPC schedule and marks the editor open', async () => {
    const schedule = createSchedule({ npcId: 'npc-42', generated: true });
    const getSchedule = mock(async () => schedule);
    const viewModel = createViewModel({
      schedules: createScheduleCapabilities({ getSchedule }),
    });

    await viewModel.open({ npcId: 'npc-42', npcName: 'Grimm' });

    expect(getSchedule).toHaveBeenCalledWith('npc-42');
    expect(viewModel.isOpen).toBe(true);
    expect(viewModel.npcName).toBe('Grimm');
    expect(viewModel.days).toEqual(schedule.days);
    expect(viewModel.isGenerated).toBe(true);
  });
});

describe('ScheduleEditorViewModel — editing', () => {
  test('paintCell applies the current paint status to the target slot', async () => {
    const viewModel = createViewModel();
    await viewModel.open({ npcId: 'npc-1', npcName: 'Grimm' });

    viewModel.setPaintStatus('dnd');
    viewModel.paintCell(2, 5);

    expect(viewModel.days[2]?.hours[5]?.status).toBe('dnd');
  });

  test('setActivity writes the activity to the target slot', async () => {
    const viewModel = createViewModel();
    await viewModel.open({ npcId: 'npc-1', npcName: 'Grimm' });

    viewModel.setActivity(1, 9, 'Smelting iron');

    expect(viewModel.days[1]?.hours[9]?.activity).toBe('Smelting iron');
  });

  test('close saves the current schedule through the capability', async () => {
    const setSchedule = mock(async () => {});
    const viewModel = createViewModel({
      schedules: createScheduleCapabilities({ setSchedule }),
    });
    await viewModel.open({ npcId: 'npc-1', npcName: 'Grimm' });

    viewModel.paintCell(0, 0);
    await viewModel.close();

    expect(setSchedule).toHaveBeenCalledTimes(1);
    const [npcId, saved] = setSchedule.mock.calls[0] as [string, NpcSchedule];
    expect(npcId).toBe('npc-1');
    expect(saved.days).toEqual(viewModel.days);
    expect(viewModel.isOpen).toBe(false);
  });
});

describe('ScheduleEditorViewModel — generation', () => {
  test('generateSchedule applies a valid 7-day result and persists it', async () => {
    const generatedDays = Array.from({ length: 7 }, (_, day) => createDay(day, 'idle'));
    const extractStructure = mock(async () => ({
      dailyPattern: 'Idle most of the day',
      schedule: { days: generatedDays },
      suggestedTalkativeness: 0.3,
    }));
    const setSchedule = mock(async () => {});
    const viewModel = createViewModel({
      schedules: createScheduleCapabilities({ setSchedule }),
      generation: createGenerationCapabilities({ extractStructure }),
    });
    await viewModel.open({ npcId: 'npc-1', npcName: 'Grimm' });

    await viewModel.generateSchedule();

    expect(extractStructure).toHaveBeenCalledTimes(1);
    expect(viewModel.days).toEqual(generatedDays);
    expect(viewModel.isGenerated).toBe(true);
    expect(viewModel.generationError).toBeUndefined();
    expect(viewModel.isGenerating).toBe(false);
    expect(setSchedule).toHaveBeenCalledTimes(1);
  });

  test('generateSchedule sets generationError on an invalid result and does not save', async () => {
    const extractStructure = mock(async () => ({
      dailyPattern: 'Broken',
      schedule: { days: [createDay(0)] },
      suggestedTalkativeness: 0.3,
    }));
    const setSchedule = mock(async () => {});
    const viewModel = createViewModel({
      schedules: createScheduleCapabilities({ setSchedule }),
      generation: createGenerationCapabilities({ extractStructure }),
    });
    await viewModel.open({ npcId: 'npc-1', npcName: 'Grimm' });

    await viewModel.generateSchedule();

    expect(viewModel.generationError).toBe('Generated schedule was invalid. Please try again.');
    expect(viewModel.isGenerating).toBe(false);
    expect(setSchedule).not.toHaveBeenCalled();
  });
});

describe('ScheduleEditorViewModel — real base class', () => {
  test('extends the production BaseViewModel, not a shared fake', async () => {
    const viewModel = createViewModel();

    expect(viewModel).toBeInstanceOf(BaseViewModel);
    expect('registerEffectRoot' in viewModel).toBe(true);
  });
});
