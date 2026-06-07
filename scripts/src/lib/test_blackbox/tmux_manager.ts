// scripts/src/lib/test_blackbox/tmux_manager.ts
// Start/stop services via the unified tmux session library.
// Uses the aikami-{mode} naming convention from scripts/src/lib/tmux/session.ts.
//
// Pattern ported from nordclaw's blackbox test infrastructure.

import type { AikamiMode, DevService } from '../tmux/session.ts';
import {
  startServices as startTmuxServices,
  stopAllSessions,
  waitForReady,
} from '../tmux/session.ts';

const MODE: AikamiMode = 'emulator'; // Blackbox tests always run in emulator mode

const toCanonicalServices = (names: string[]): DevService[] => {
  const valid: DevService[] = ['emulators', 'pwa'];
  return names.filter((n) => valid.includes(n as DevService)) as DevService[];
};

export const startServices = async (
  options: { only?: string[]; timeoutMs?: number; force?: boolean; projectRoot?: string } = {},
): Promise<void> => {
  const { only, timeoutMs = 180_000, force = false, projectRoot = process.cwd() } = options;

  if (!only || only.length === 0) {
    return;
  }

  const services = toCanonicalServices(only);

  console.log(`Starting services in tmux (${only.join(', ')})${force ? ' [force]' : ''}...`);

  await startTmuxServices({
    services,
    mode: MODE,
    force,
    projectRoot,
  });

  // Wait for readiness
  await waitForReady({ services, mode: MODE }, timeoutMs);
};

export const stopServices = async (): Promise<void> => {
  await stopAllSessions();
};
