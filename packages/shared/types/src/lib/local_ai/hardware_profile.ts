// packages/shared/types/src/lib/local_ai/hardware_profile.ts

import type { HardwareProfileSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type HardwareProfile = Static<typeof HardwareProfileSchema>;
export type GpuVendor = HardwareProfile['gpu']['vendor'];
export type CudaMajor = NonNullable<HardwareProfile['gpu']['cudaMajor']>;
