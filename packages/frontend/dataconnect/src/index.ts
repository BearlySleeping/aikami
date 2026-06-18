// packages/frontend/dataconnect/src/index.ts
//
// Wrapper around generated Firebase Data Connect SDK queries.
// Automatically injects the shared Data Connect singleton so consumers
// (SvelteKit ViewModels) don't need to manage connection state.
//
// Generated SDK path: src/lib/generated/
// Regenerate with: bun run generate (firestack generate)

import { getDataConnect } from '@aikami/frontend/configs/data_connect';
import { connectorConfig } from './lib/generated';

const dataConnect = getDataConnect(connectorConfig);

// Re-export generated types so consumers can use typed variables.
export type * from './lib/generated';
// Re-export generated query/mutation action shortcut functions.
// Re-export refs for advanced usage.
export {
  getTracksByMood,
  getTracksByMoodRef,
  listSaveSlots,
  listSaveSlotsRef,
  upsertSaveSlot,
  upsertSaveSlotRef,
} from './lib/generated';
// Re-export the connector config and pre-wired DataConnect instance.
export { connectorConfig, dataConnect };
