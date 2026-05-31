// apps/backend/firebase/firestack.config.ts

import { defineConfig } from '@snorreks/firestack';
import {
  CLOUD_FUNCTIONS_REGION,
  EMULATOR_PORTS,
  MODE_PROJECT_MAP,
} from '../../../packages/shared/constants/src/index.ts';

export default defineConfig(() => ({
  modes: MODE_PROJECT_MAP,
  region: CLOUD_FUNCTIONS_REGION,
  nodeVersion: '24',
  engine: 'bun' as const,
  emulatorPorts: EMULATOR_PORTS,
  minify: true,
  sourcemap: true,
  cloudCacheFileName: 'functions_cache.ts',
}));
