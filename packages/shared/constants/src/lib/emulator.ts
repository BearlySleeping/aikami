// packages/shared/constants/src/lib/emulator.ts
// Single source of truth for emulator ports, hosts, project ID.

import { EMULATOR_PORTS } from './development_ports.ts';
import { CLOUD_FUNCTIONS_REGION, MODE_PROJECT_MAP } from './project.ts';

// ── Project & Region ──────────────────────────────────────────
export const EMULATOR_PROJECT_ID = MODE_PROJECT_MAP.emulator;
export const EMULATOR_REGION = CLOUD_FUNCTIONS_REGION;

export const EMULATOR_HOSTS = {
  auth: `localhost:${EMULATOR_PORTS.auth}`,
  functions: `localhost:${EMULATOR_PORTS.functions}`,
  hosting: `localhost:${EMULATOR_PORTS.hosting}`,
  storage: `localhost:${EMULATOR_PORTS.storage}`,
  pubsub: `localhost:${EMULATOR_PORTS.pubsub}`,
} as const;

export const EMULATOR_HEALTH_URLS = {
  auth: `http://${EMULATOR_HOSTS.auth}`,
} as const;
