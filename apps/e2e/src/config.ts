// apps/e2e/src/config.ts
// E2E runtime port configuration.
//
// Keep this module the single E2E consumer of port allocation. The Playwright
// config, service map, visual runner, and tests all read the resulting values;
// adding a second offset calculation here would reintroduce cross-process
// double-shifts.

import { E2E_PORT_BASES, E2E_PORT_OFFSETS, getE2EPortOffset } from './services/port_allocation';

export const IS_E2E_CI = process.env.CI === 'true' || process.env.CI === '1';

/** Stable checkout offset selected by the E2E port allocator. */
export const E2E_PORT_OFFSET = getE2EPortOffset();

const offsetPort = (base: number): number => base + E2E_PORT_OFFSET;

const HUB_BASE_PORT = offsetPort(E2E_PORT_BASES.hub);
const HUB_WORKER_PORT = offsetPort(E2E_PORT_BASES.hubWorker);

/**
 * Effective E2E ports.
 *
 * CI serves the hub through Wrangler's local Worker runtime, so `hub` is the
 * worker port there. Local development uses the Vite SSR port. Keeping that
 * choice here makes auth fixtures, Playwright, and preflight agree in CI.
 */
export const EMULATOR_PORTS = {
  client: offsetPort(E2E_PORT_BASES.client),
  /** A second client with PUBLIC_COMBAT_LLM_AGENTS=1. */
  clientLlm: offsetPort(E2E_PORT_BASES.clientLlm),
  hub: IS_E2E_CI ? HUB_WORKER_PORT : HUB_BASE_PORT,
  hubBase: HUB_BASE_PORT,
  hubWorker: HUB_WORKER_PORT,
  site: offsetPort(E2E_PORT_BASES.site),
  voice: 8089,
} as const;

/** The complete non-zero slot space used by linked worktrees. */
export { E2E_PORT_OFFSETS };
