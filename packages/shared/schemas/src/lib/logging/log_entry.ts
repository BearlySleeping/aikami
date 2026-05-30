// packages/shared/schemas/src/lib/logging/log_entry.ts
import { z } from 'zod';

export const LogLevelSchema = z.enum([
  'DEBUG',
  'INFO',
  'NOTICE',
  'WARNING',
  'ERROR',
  'CRITICAL',
  'ALERT',
  'EMERGENCY',
]);
