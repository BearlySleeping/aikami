// scripts/src/lib/test_blackbox/tmux_manager.ts
// Start/stop services via the unified tmux session library.
// Uses the aikami-{mode}-{service} naming convention from scripts/src/lib/tmux/session.ts.
//
// Pattern ported from nordclaw's blackbox test infrastructure.

import { resolve } from 'node:path';
import {
  buildSessionName,
  startSession,
  stopSession,
  waitForReady,
  stopAllSessions,
} from '../tmux/session.ts';
import type { AikamiMode, TmuxService } from '../tmux/session.ts';

const MODE: AikamiMode = 'emulator'; // Blackbox tests always run in emulator mode

const buildServiceOptions = (
  only: string[],
  projectRoot: string,
): { service: TmuxService }[] => {
  const map: Record<string, TmuxService> = {
    emulators: 'emulators',
    pwa: 'pwa',
    game: 'game',
  };

  return only
    .filter((n) => map[n])
    .map((n) => ({
      service: map[n],
    }));
};

export const startServices = async (
  options: { only?: string[]; timeoutMs?: number; force?: boolean; projectRoot?: string } = {},
): Promise<void> => {
  const { only, timeoutMs = 180_000, force = false, projectRoot = process.cwd() } = options;

  if (!only || only.length === 0) return;

  const services = buildServiceOptions(only, projectRoot);

  console.log(`Starting services in tmux (${only.join(', ')})${force ? ' [force]' : ''}...`);

  for (const svc of services) {
    await startSession({
      service: svc.service,
      mode: MODE,
      force,
      projectRoot,
    });
  }

  // Wait for readiness
  for (const svc of services) {
    await waitForReady({ service: svc.service, mode: MODE }, timeoutMs);
  }
};

export const stopServices = async (): Promise<void> => {
  await stopAllSessions();
};
