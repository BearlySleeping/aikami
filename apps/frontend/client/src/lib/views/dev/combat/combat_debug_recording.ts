// apps/frontend/client/src/lib/views/dev/combat/combat_debug_recording.ts

import { COMBAT_REPRODUCTION_MAX_CHECKPOINTS } from '@aikami/schemas';
import type {
  CombatCommand,
  CombatEvent,
  CombatReproductionCheckpoint,
  CombatState,
} from '@aikami/types';
import type { CombatDebugAcceptedCommandRecord } from './types/combat_debug_types.ts';

/** Replay history captured from one live combat debug session. */
export type CombatDebugRecordingSnapshot = {
  readonly recordedInitialState: CombatState;
  readonly commands: readonly CombatCommand[];
  readonly checkpoints: readonly CombatReproductionCheckpoint[];
  readonly expectedEvents: readonly CombatEvent[];
  readonly replayHistoryAvailable: boolean;
};

/** Mutable session recorder kept outside the reactive workspace ViewModel. */
export type CombatDebugRecording = {
  readonly acceptedCommands: readonly CombatDebugAcceptedCommandRecord[];
  readonly events: readonly CombatEvent[];
  captureInitialState(state: CombatState): void;
  appendEvents(events: readonly CombatEvent[]): void;
  recordAcceptedCommand(record: CombatDebugAcceptedCommandRecord): void;
  markHistoryUnavailable(): void;
  snapshot(): CombatDebugRecordingSnapshot | undefined;
  reset(): void;
};

/** Creates a bounded recorder for a single live combat debug session. */
export const createCombatDebugRecording = (): CombatDebugRecording => {
  let recordedInitialState: CombatState | undefined;
  let acceptedCommands: CombatDebugAcceptedCommandRecord[] = [];
  let events: CombatEvent[] = [];
  let checkpoints: CombatReproductionCheckpoint[] = [];
  let replayHistoryAvailable = true;

  return {
    get acceptedCommands() {
      return acceptedCommands;
    },
    get events() {
      return events;
    },
    captureInitialState(state) {
      if (recordedInitialState !== undefined) {
        return;
      }
      if (acceptedCommands.length > 0 || events.length > 0) {
        replayHistoryAvailable = false;
      }
      recordedInitialState = structuredClone(state);
    },
    appendEvents(committedEvents) {
      events = [...events, ...committedEvents.map((event) => structuredClone(event))];
    },
    recordAcceptedCommand(record) {
      if (record.duplicate) {
        return;
      }
      acceptedCommands = [...acceptedCommands, record];
      if (record.replayCommand === undefined) {
        replayHistoryAvailable = false;
        return;
      }
      if (checkpoints.length >= COMBAT_REPRODUCTION_MAX_CHECKPOINTS) {
        replayHistoryAvailable = false;
        return;
      }
      checkpoints = [
        ...checkpoints,
        {
          name: `accepted-command-${checkpoints.length + 1}`,
          stateRevision: record.stateRevision,
          throughCommandIndex: acceptedCommands.length - 1,
        },
      ];
    },
    markHistoryUnavailable() {
      replayHistoryAvailable = false;
    },
    snapshot() {
      if (recordedInitialState === undefined) {
        return undefined;
      }
      return {
        recordedInitialState,
        commands: acceptedCommands.flatMap(({ replayCommand }) =>
          replayCommand === undefined ? [] : [replayCommand],
        ),
        checkpoints,
        expectedEvents: events,
        replayHistoryAvailable,
      };
    },
    reset() {
      recordedInitialState = undefined;
      acceptedCommands = [];
      events = [];
      checkpoints = [];
      replayHistoryAvailable = true;
    },
  };
};
