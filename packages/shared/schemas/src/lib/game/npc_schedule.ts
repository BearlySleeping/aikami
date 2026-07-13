// packages/shared/schemas/src/lib/npc_schedule.ts
//
// TypeBox schemas for NPC autonomous behavior schedules.
// Source of truth for all schedule-related data validation.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { type Static, Type } from 'typebox';

// ── Availability status ──────────────────────────────────────────────────

export const AvailabilityStatusSchema = Type.Union([
  Type.Literal('online'),
  Type.Literal('idle'),
  Type.Literal('dnd'),
  Type.Literal('offline'),
]);

export type AvailabilityStatus = Static<typeof AvailabilityStatusSchema>;

// ── Hour slot ────────────────────────────────────────────────────────────

export const HourSlotSchema = Type.Object({
  hour: Type.Integer({ minimum: 0, maximum: 23, description: 'Hour of the day (0-23)' }),
  status: AvailabilityStatusSchema,
  activity: Type.Optional(Type.String({ description: 'Human-readable activity description' })),
});

export type HourSlot = Static<typeof HourSlotSchema>;

// ── Day schedule ─────────────────────────────────────────────────────────

export const DayScheduleSchema = Type.Object({
  day: Type.Integer({
    minimum: 0,
    maximum: 6,
    description: 'Day of the week (0=Sunday, 6=Saturday)',
  }),
  hours: Type.Array(HourSlotSchema, { minItems: 24, maxItems: 24, description: '24 hourly slots' }),
});

export type DaySchedule = Static<typeof DayScheduleSchema>;

// ── NPC schedule ─────────────────────────────────────────────────────────

export const NpcScheduleSchema = Type.Object({
  npcId: Type.String({ description: 'NPC ID this schedule belongs to' }),
  days: Type.Array(DayScheduleSchema, {
    minItems: 7,
    maxItems: 7,
    description: '7 days of the week',
  }),
  autonomousEnabled: Type.Boolean({
    description: 'Whether autonomous messages are enabled',
    default: true,
  }),
  talkativeness: Type.Number({
    minimum: 0,
    maximum: 1,
    description: 'Talkativeness weight (0-1)',
    default: 0.5,
  }),
  cooldownMinutes: Type.Number({
    minimum: 1,
    maximum: 120,
    description: 'Cooldown minutes between messages',
    default: 15,
  }),
  generated: Type.Boolean({
    description: 'Whether auto-generated or manually edited',
    default: false,
  }),
  updatedAt: Type.String({ description: 'ISO-8601 timestamp of last update' }),
});

export type NpcSchedule = Static<typeof NpcScheduleSchema>;

// ── Schedule planner output ──────────────────────────────────────────────

export const SchedulePlannerOutputSchema = Type.Object({
  dailyPattern: Type.String({
    minLength: 1,
    description: 'Overall daily pattern summary (1-2 sentences)',
  }),
  schedule: Type.Object({
    days: Type.Array(DayScheduleSchema, {
      minItems: 7,
      maxItems: 7,
      description: 'Generated 7-day schedule',
    }),
  }),
  suggestedTalkativeness: Type.Number({
    minimum: 0,
    maximum: 1,
    description: 'Suggested talkativeness value (0-1)',
  }),
});

export type SchedulePlannerOutput = Static<typeof SchedulePlannerOutputSchema>;

// ── Default schedule factory ─────────────────────────────────────────────

/**
 * Creates a default 7×24 schedule where all hours are 'online' with
 * activity 'Available'. Used when no schedule data exists for an NPC.
 */
export const createDefaultSchedule = (npcId: string): NpcSchedule => {
  const makeDay = (day: number): DaySchedule => ({
    day,
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      status: 'online' as const,
      activity: 'Available',
    })),
  });

  return {
    npcId,
    days: Array.from({ length: 7 }, (_, day) => makeDay(day)),
    autonomousEnabled: true,
    talkativeness: 0.5,
    cooldownMinutes: 15,
    generated: false,
    updatedAt: new Date().toISOString(),
  };
};
