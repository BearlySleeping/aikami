// apps/backend/firebase/firestack.config.ts

import { defineConfig } from '@snorreks/firestack';
import {
  CLOUD_FUNCTIONS_REGION,
  EMULATOR_PORTS,
  MODE_PROJECT_MAP,
  withPortOffset,
} from '../../../packages/shared/constants/src/index.ts';

// Shifts the whole emulator suite for contract-scoped pipeline runs so
// concurrent contracts never fight over the same Firebase emulator ports.
// scripts/src/lib/herdr/session.ts sets this env var when starting the
// `firebase` tab for a contract workspace (0 for a manual, non-contract run).
const emulatorPorts = withPortOffset(
  EMULATOR_PORTS,
  Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0),
);

export default defineConfig(() => ({
  modes: MODE_PROJECT_MAP,
  region: CLOUD_FUNCTIONS_REGION,
  nodeVersion: '24',
  engine: 'bun' as const,
  emulatorPorts,
  minify: true,
  sourcemap: true,

  cloudCacheFileName: 'functions_cache.ts',
}));
