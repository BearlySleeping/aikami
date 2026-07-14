// scripts/src/lib/herdr/index.ts
/**
 * Herdr integration barrel (C-311).
 */

export type {
  AgentListEntry,
  PaneListEntry,
  PaneReadResult,
  TabListEntry,
  WorkspaceListEntry,
} from './socket_client';
export { HerdrSocketClient } from './socket_client';
