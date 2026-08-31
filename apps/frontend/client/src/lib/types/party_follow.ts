// apps/frontend/client/src/lib/types/party_follow.ts

import type {
  BaseFrontendClassInterface,
  BaseFrontendClassOptions,
} from '@aikami/frontend/services';

/** Construction options for the party-follow lifecycle service. */
export type PartyFollowServiceOptions = BaseFrontendClassOptions;

/** Client lifecycle contract for synchronizing party membership with the engine. */
export type PartyFollowServiceInterface = BaseFrontendClassInterface & {
  /** Whether party-follow synchronization is active. */
  readonly isRunning: boolean;
  /** Enables party-follow synchronization. */
  start(): void;
  /** Disables party-follow synchronization. */
  stop(): void;
  /** Re-applies recruited party members after a map load. */
  onMapLoaded(): void;
};
