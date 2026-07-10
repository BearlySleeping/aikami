// packages/shared/constants/src/lib/autonomous_npc.ts
//
// Default values and labels for the autonomous NPC behavior system.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

// ── Default timing values ────────────────────────────────────────────────

/** Default idle threshold in milliseconds (5 minutes). */
export const DEFAULT_IDLE_THRESHOLD_MS = 5 * 60 * 1000;

/** Minimum idle threshold in milliseconds (1 minute). */
export const MIN_IDLE_THRESHOLD_MS = 1 * 60 * 1000;

/** Maximum idle threshold in milliseconds (30 minutes). */
export const MAX_IDLE_THRESHOLD_MS = 30 * 60 * 1000;

/** Default poller interval in milliseconds (60 seconds). */
export const DEFAULT_POLLER_INTERVAL_MS = 60 * 1000;

/** Minimum poller interval in milliseconds (30 seconds). */
export const MIN_POLLER_INTERVAL_MS = 30 * 1000;

/** Maximum poller interval in milliseconds (5 minutes). */
export const MAX_POLLER_INTERVAL_MS = 5 * 60 * 1000;

/** Default cooldown between autonomous messages in minutes. */
export const DEFAULT_COOLDOWN_MINUTES = 15;

/** Minimum cooldown in minutes. */
export const MIN_COOLDOWN_MINUTES = 5;

/** Maximum cooldown in minutes. */
export const MAX_COOLDOWN_MINUTES = 60;

/** Default talkativeness value for NPCs (0-1). */
export const DEFAULT_TALKATIVENESS = 0.5;

/** Mobile battery optimization: poller interval multiplier on low battery. */
export const MOBILE_LOW_BATTERY_INTERVAL_MULTIPLIER = 2;

/** Mobile battery threshold for optimization (< 0.2 = low battery). */
export const MOBILE_LOW_BATTERY_THRESHOLD = 0.2;

/** Maximum autonomous messages per poller tick. */
export const MAX_AUTONOMOUS_MESSAGES_PER_TICK = 1;

/** Number of recent chat messages to include in autonomous prompt context. */
export const AUTONOMOUS_CONTEXT_MESSAGE_COUNT = 5;

// ── Default activity labels ──────────────────────────────────────────────

/** Default activity text when no activity is specified for a time slot. */
export const DEFAULT_ACTIVITY_LABEL = 'Available';

// ── Firestore collection ─────────────────────────────────────────────────

/** Firestore sub-collection name for NPC schedules (under each NPC doc). */
export const NPC_SCHEDULE_SUBCOLLECTION = 'schedules';

/** Firestore document ID for the single schedule per NPC (always "default"). */
export const NPC_SCHEDULE_DOC_ID = 'default';

// ── Availability status labels ───────────────────────────────────────────

export const AVAILABILITY_STATUS_LABELS: Record<string, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
} as const;

export const AVAILABILITY_STATUS_COLORS: Record<string, string> = {
  online: 'bg-success',
  idle: 'bg-warning',
  dnd: 'bg-error',
  offline: 'bg-neutral',
} as const;

// ── Day-of-week labels ───────────────────────────────────────────────────

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// ── Hour labels ──────────────────────────────────────────────────────────

export const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour === 0 ? '12' : hour <= 12 ? String(hour) : String(hour - 12);
  return `${display}${suffix}`;
});
