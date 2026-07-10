// apps/frontend/client/src/lib/services/npc/npc_schedule_service.test.ts
//
// Unit tests for NpcScheduleService — CRUD, getCurrentStatus(),
// isAvailable(), default schedule fallback, and cache behavior.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Firestore
const mockSetDoc = vi.fn();
const mockGetDoc = vi.fn();
const mockDoc = vi.fn(() => 'doc-ref');
const mockCollection = vi.fn(() => 'collection-ref');

const mockFirestore = {
  firestore: {} as unknown,
  doc: mockDoc,
  collection: mockCollection,
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
};

vi.doMock('@aikami/frontend/configs/firestore.ts', () => ({
  default: mockFirestore,
  ...mockFirestore,
}));

describe('NpcScheduleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2026-07-10T14:30:00Z')); // Friday (5), 14:30
  });

  it('should return default schedule when no Firestore document exists', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const schedule = await npcScheduleService.getSchedule('npc-123');

    expect(schedule.npcId).toBe('npc-123');
    expect(schedule.days).toHaveLength(7);
    expect(schedule.days[0].hours).toHaveLength(24);
    expect(schedule.days[0].hours[0].status).toBe('online');
    expect(schedule.autonomousEnabled).toBe(true);
    expect(schedule.talkativeness).toBe(0.5);
    expect(schedule.cooldownMinutes).toBe(15);
    expect(schedule.generated).toBe(false);

    vi.resetModules();
  });

  it('should return persisted schedule from Firestore', async () => {
    const storedSchedule = {
      npcId: 'npc-456',
      days: Array.from({ length: 7 }, (_, day) => ({
        day,
        hours: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          status: day === 0 ? ('offline' as const) : ('online' as const),
          activity: day === 0 ? 'Resting' : 'Working',
        })),
      })),
      autonomousEnabled: true,
      talkativeness: 0.8,
      cooldownMinutes: 10,
      generated: true,
      updatedAt: '2026-07-10T12:00:00Z',
    };

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => storedSchedule,
    });

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const schedule = await npcScheduleService.getSchedule('npc-456');

    expect(schedule.talkativeness).toBe(0.8);
    expect(schedule.cooldownMinutes).toBe(10);
    expect(schedule.generated).toBe(true);
    expect(schedule.days[0].hours[0].status).toBe('offline');

    vi.resetModules();
  });

  it('should save schedule to Firestore via setSchedule', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const schedule = await npcScheduleService.getSchedule('npc-789');
    schedule.talkativeness = 0.3;
    schedule.generated = true;

    await npcScheduleService.setSchedule('npc-789', schedule);

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const callArgs = mockSetDoc.mock.calls[0];
    expect(callArgs[1].talkativeness).toBe(0.3);
    expect(callArgs[1].generated).toBe(true);

    vi.resetModules();
  });

  it('should return current status based on local time', async () => {
    // Friday (5) at 14:30 — slot for hour 14 on day 5
    const storedSchedule = {
      npcId: 'npc-abc',
      days: Array.from({ length: 7 }, (_, day) => ({
        day,
        hours: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          status: (day === 5 && hour === 14 ? 'idle' : 'online') as const,
          activity: day === 5 && hour === 14 ? 'Taking a break' : 'Available',
        })),
      })),
      autonomousEnabled: true,
      talkativeness: 0.5,
      cooldownMinutes: 15,
      generated: false,
      updatedAt: '2026-07-10T12:00:00Z',
    };

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => storedSchedule,
    });

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const status = await npcScheduleService.getCurrentStatus('npc-abc');

    expect(status.status).toBe('idle');
    expect(status.activity).toBe('Taking a break');

    vi.resetModules();
  });

  it('should report availability correctly', async () => {
    const storedSchedule = {
      npcId: 'npc-xyz',
      days: Array.from({ length: 7 }, (_, day) => ({
        day,
        hours: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          status: (day === 5 && hour === 14 ? 'dnd' : 'online') as const,
          activity: 'Working',
        })),
      })),
      autonomousEnabled: true,
      talkativeness: 0.5,
      cooldownMinutes: 15,
      generated: false,
      updatedAt: '2026-07-10T12:00:00Z',
    };

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => storedSchedule,
    });

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');

    // Friday 14:00 = DND → not available
    const available = await npcScheduleService.isAvailable('npc-xyz');
    expect(available).toBe(false);

    vi.resetModules();
  });

  it('should default to online/available for missing day/hour slots', async () => {
    const storedSchedule = {
      npcId: 'npc-gap',
      days: [
        { day: 0, hours: [] }, // Missing hours
      ],
      autonomousEnabled: true,
      talkativeness: 0.5,
      cooldownMinutes: 15,
      generated: false,
      updatedAt: '2026-07-10T12:00:00Z',
    };

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => storedSchedule,
    });

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const status = await npcScheduleService.getCurrentStatus('npc-gap');

    expect(status.status).toBe('online');
    expect(status.activity).toBe('Available');

    vi.resetModules();
  });
});
