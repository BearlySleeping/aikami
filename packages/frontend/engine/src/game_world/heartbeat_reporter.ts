// packages/frontend/engine/src/game_world/heartbeat_reporter.ts
//
// Turns a worker heartbeat event into a single warn log. Extracted from
// `game_world.ts` (source-size waiver) as a leaf collaborator: it holds no
// state and never touches the renderer or the ECS world.

import type { HeartbeatEvent } from './worker_session.ts';

/** Log sink; the caller supplies GameWorld's class-prefixed `warn`. */
export type HeartbeatWarn = (message: string, detail?: Record<string, unknown>) => void;

/** Reports one heartbeat event (stall or missed heartbeat) at warn level. */
export const reportHeartbeatEvent = (event: HeartbeatEvent, warn: HeartbeatWarn): void => {
  if (event.kind === 'stall') {
    warn('[GameWorld] WARN: Simulation stalled — tickCount unchanged for 3 heartbeats', {
      tickCount: event.tickCount,
      staleCycles: event.staleCycles,
      writableBufferCount: event.writableBufferCount,
      syncWithBuffer: event.syncWithBuffer,
      syncWithoutBuffer: event.syncWithoutBuffer,
      recycled: event.recycled,
    });
    return;
  }
  warn('[GameWorld] WARN: Worker engine heartbeat missed!', {
    elapsedMs: event.elapsedMs,
    missedCount: event.missedCount,
  });
};
