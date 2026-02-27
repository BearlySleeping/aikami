import { z } from 'zod';

export const FCMPlatformSchema = z.enum(['android', 'ios', 'web']);
