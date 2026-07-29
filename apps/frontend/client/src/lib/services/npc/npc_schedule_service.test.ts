// apps/frontend/client/src/lib/services/npc/npc_schedule_service.test.ts
//
// Unit tests for NpcScheduleService — CRUD, getCurrentStatus(),
// isAvailable(), default schedule fallback, and cache behavior.
// Updated for Turso/libSQL persistence (replaces Firestore).
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { NpcSchedule } from '@aikami/types';

// ── Mock Date ────────────────────────────────────────────────────────────

const MOCK_NOW = new Date('2026-07-10T14:30:00Z'); // Friday (day 5), 14:30 UTC

const OriginalDate = globalThis.Date;

const installFakeDate = (): void => {
  const FakeDate = function (this: Date, ...args: unknown[]) {
    if (args.length === 0) {
      return new OriginalDate(MOCK_NOW);
    }
    return new (OriginalDate as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  FakeDate.prototype = OriginalDate.prototype;
  FakeDate.now = () => MOCK_NOW.getTime();
  FakeDate.UTC = OriginalDate.UTC;
  FakeDate.parse = OriginalDate.parse;
  globalThis.Date = FakeDate;
};

const restoreRealDate = (): void => {
  globalThis.Date = OriginalDate;
};

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Seeds a schedule row into the fake in-memory database provided by
 * test_preload's mock of @aikami/frontend/repositories.
 */
const seedSchedule = async (npcId: string, schedule: NpcSchedule): Promise<void> => {
  const repos = await import('@aikami/frontend/repositories');
  const db = await repos.getLocalDatabase();
  await db.execute({
    sql: 'INSERT OR REPLACE INTO npc_schedules (npc_id, data, updated_at) VALUES (?, ?, ?)',
    args: [npcId, JSON.stringify(schedule), schedule.updatedAt],
  });
};

/**
 * Resets the fake database tables between tests.
 */
const resetDb = async (): Promise<void> => {
  const repos = await import('@aikami/frontend/repositories');
  (repos as unknown as { resetLocalDatabase: () => void }).resetLocalDatabase();
};

describe('NpcScheduleService', () => {
  beforeEach(async () => {
    await resetDb();
    installFakeDate();
  });

  afterEach(() => {
    restoreRealDate();
  });

  it('should return default schedule when no stored schedule exists', async () => {
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
  });

  it('should return persisted schedule from the database', async () => {
    const storedSchedule: NpcSchedule = {
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

    await seedSchedule('npc-456', storedSchedule);

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const schedule = await npcScheduleService.getSchedule('npc-456');

    expect(schedule.talkativeness).toBe(0.8);
    expect(schedule.cooldownMinutes).toBe(10);
    expect(schedule.generated).toBe(true);
    expect(schedule.days[0].hours[0].status).toBe('offline');
  });

  it('should save schedule to the database via setSchedule', async () => {
    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const schedule = await npcScheduleService.getSchedule('npc-789');
    schedule.talkativeness = 0.3;
    schedule.generated = true;

    await npcScheduleService.setSchedule('npc-789', schedule);

    // Verify persistence by reading from the database directly
    const repos = await import('@aikami/frontend/repositories');
    const db = await repos.getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT data FROM npc_schedules WHERE npc_id = ?',
      args: ['npc-789'],
    });

    expect(result.rows).toHaveLength(1);
    const stored = JSON.parse(result.rows[0].data as string) as Record<string, unknown>;
    expect(stored.talkativeness).toBe(0.3);
    expect(stored.generated).toBe(true);
  });

  it('should return current status based on local time', async () => {
    // Friday (5) at 14:30 — mock the date inside the imported module
    const storedSchedule: NpcSchedule = {
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

    await seedSchedule('npc-abc', storedSchedule);

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const status = await npcScheduleService.getCurrentStatus('npc-abc');

    expect(status.status).toBe('idle');
    expect(status.activity).toBe('Taking a break');
  });

  it('should report availability correctly', async () => {
    const storedSchedule: NpcSchedule = {
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

    await seedSchedule('npc-xyz', storedSchedule);

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');

    // Friday 14:00 = DND → not available
    const available = await npcScheduleService.isAvailable('npc-xyz');
    expect(available).toBe(false);
  });

  it('should default to online/available for missing day/hour slots', async () => {
    const storedSchedule: NpcSchedule = {
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

    await seedSchedule('npc-gap', storedSchedule);

    const { npcScheduleService } = await import('../npc/npc_schedule_service.svelte.ts');
    const status = await npcScheduleService.getCurrentStatus('npc-gap');

    expect(status.status).toBe('online');
    expect(status.activity).toBe('Available');
  });
});
