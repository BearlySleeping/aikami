// packages/shared/types/src/lib/database/notification.ts
//
// Schema-derived names re-exported from @aikami/schemas; hand-authored types remain.

import type { NotificationTypesSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

// ── Re-exports from schemas (source of truth) ───────────────────────────

export type {
  Notification as NotificationData,
  NotificationCreate as NotificationCreateData,
  NotificationText,
} from '@aikami/schemas';

// ── Hand-authored types derived from schema internals ───────────────────

type NotificationTypes = Type.Static<typeof NotificationTypesSchema>;

export type NotificationPayload<T extends NotificationType = NotificationType> =
  NotificationTypes[T];

export type NotificationType = keyof NotificationTypes;
