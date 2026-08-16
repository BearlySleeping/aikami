// apps/backend/firebase/firestack.config.ts

import { defineConfig } from '@snorreks/firestack';
import {
  CLOUD_FUNCTIONS_REGION,
  EMULATOR_PORTS,
  MODE_PROJECT_MAP,
  withPortOffset,
  withProjectIdOffset,
} from '../../../packages/shared/constants/src/index.ts';

// Shifts the whole emulator suite for contract-scoped pipeline runs so
// concurrent contracts never fight over the same Firebase emulator ports.
// scripts/src/lib/herdr/session.ts sets this env var when starting the
// `firebase` tab for a contract workspace (0 for a manual, non-contract run).
const emulatorPortOffset = Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0);
const emulatorPorts = withPortOffset(EMULATOR_PORTS, emulatorPortOffset);

// Per-port offsetting alone isn't enough for concurrent `firestack emulate`
// instances to coexist — see withProjectIdOffset's doc for why (firebase-tools'
// Emulator Hub coordinates by project id, not by port). staging/production
// are real GCP projects and must never be touched by this.
const modes = {
  ...MODE_PROJECT_MAP,
  emulator: withProjectIdOffset(MODE_PROJECT_MAP.emulator, emulatorPortOffset),
  testing: withProjectIdOffset(MODE_PROJECT_MAP.testing, emulatorPortOffset),
};

export default defineConfig(() => ({
  modes,
  region: CLOUD_FUNCTIONS_REGION,
  nodeVersion: '24',
  engine: 'bun' as const,
  emulatorPorts,
  minify: true,
  sourcemap: true,

  cloudCacheFileName: 'functions_cache.ts',

  rulesTests: {
    firestore: {
      rulesFile: 'src/rules/firestore.rules',
      testPattern: 'tests/rules/**/*.rules.test.ts',
      projectId: 'demo-aikami-emulator',
    },
  },
}));
