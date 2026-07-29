// apps/frontend/client/src/lib/services/npc/npc_schedule_service.svelte.ts
//
// NPC Schedule Service — manages per-NPC 7×24 availability schedules
// persisted to the local Turso/libSQL database. Provides CRUD,
// time-based status lookup, and availability checks.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import {
  DEFAULT_ACTIVITY_LABEL,
  DEFAULT_COOLDOWN_MINUTES,
  DEFAULT_TALKATIVENESS,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { NpcScheduleSchema, schemaCheck } from '@aikami/schemas';
import type { AvailabilityStatus, NpcSchedule } from '@aikami/types';
import { npcScheduleRepository } from './npc_schedule_repository.svelte.ts';

// ── Types ────────────────────────────────────────────────────────────────

export type CurrentStatus = {
  status: AvailabilityStatus;
  activity: string;
};

export type NpcScheduleServiceInterface = BaseFrontendClassInterface & {
  /** Retrieves the schedule for a given NPC, or the default if none exists. */
  getSchedule(npcId: string): Promise<NpcSchedule>;

  /** Persists a schedule to the local database. */
  setSchedule(npcId: string, schedule: NpcSchedule): Promise<void>;

  /** Looks up the NPC's current status based on local time. */
  getCurrentStatus(npcId: string): Promise<CurrentStatus>;

  /** Checks if the NPC is available (online or idle, not dnd or offline). */
  isAvailable(npcId: string): Promise<boolean>;
};

// ── Implementation ───────────────────────────────────────────────────────

class NpcScheduleService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements NpcScheduleServiceInterface
{
  private _cache = new Map<string, NpcSchedule>();

  // ── Default schedule factory ────────────────────────────────────────

  private _createDefaultSchedule(npcId: string): NpcSchedule {
    const makeDay = (day: number) => ({
      day,
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        status: 'online' as const,
        activity: DEFAULT_ACTIVITY_LABEL,
      })),
    });

    return {
      npcId,
      days: Array.from({ length: 7 }, (_, day) => makeDay(day)),
      autonomousEnabled: true,
      talkativeness: DEFAULT_TALKATIVENESS,
      cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
      generated: false,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── Public API ──────────────────────────────────────────────────────

  async getSchedule(npcId: string): Promise<NpcSchedule> {
    const cached = this._cache.get(npcId);
    if (cached) {
      return cached;
    }

    const stored = await npcScheduleRepository.getByNpcId(npcId);

    if (!stored) {
      const defaultSchedule = this._createDefaultSchedule(npcId);
      this._cache.set(npcId, defaultSchedule);
      return defaultSchedule;
    }

    const valid = schemaCheck(NpcScheduleSchema, stored);
    if (!valid) {
      this.warn('getSchedule:invalid-schema', { npcId });
      const defaultSchedule = this._createDefaultSchedule(npcId);
      this._cache.set(npcId, defaultSchedule);
      return defaultSchedule;
    }

    this._cache.set(npcId, stored);
    return stored;
  }

  async setSchedule(npcId: string, schedule: NpcSchedule): Promise<void> {
    const data = {
      ...schedule,
      npcId,
      updatedAt: new Date().toISOString(),
    };

    await npcScheduleRepository.upsert({ npcId, schedule: data });
    this._cache.set(npcId, data);
  }

  async getCurrentStatus(npcId: string): Promise<CurrentStatus> {
    const schedule = await this.getSchedule(npcId);

    const now = new Date();
    const day = now.getDay(); // 0=Sunday, 6=Saturday
    const hour = now.getHours();

    const daySchedule = schedule.days[day];
    if (!daySchedule) {
      return { status: 'online', activity: DEFAULT_ACTIVITY_LABEL };
    }

    const hourSlot = daySchedule.hours[hour];
    if (!hourSlot) {
      return { status: 'online', activity: DEFAULT_ACTIVITY_LABEL };
    }

    return {
      status: hourSlot.status as AvailabilityStatus,
      activity: hourSlot.activity ?? DEFAULT_ACTIVITY_LABEL,
    };
  }

  async isAvailable(npcId: string): Promise<boolean> {
    const { status } = await this.getCurrentStatus(npcId);
    return status === 'online' || status === 'idle';
  }
}

export const npcScheduleService: NpcScheduleServiceInterface = NpcScheduleService.create({
  className: 'NpcScheduleService',
}) as NpcScheduleServiceInterface;
