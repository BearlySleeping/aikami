// apps/frontend/client/src/lib/types/service_options.ts

import type { BaseFrontendClassOptions } from '@aikami/frontend/services';

/** Options used to construct the legacy AI service. */
export type AiServiceOptions = BaseFrontendClassOptions;

/** Options used to construct the expression-detection service. */
export type ExpressionServiceOptions = BaseFrontendClassOptions;

/** Options used to construct the combat state service. */
export type CombatServiceOptions = BaseFrontendClassOptions;

/** Options used to construct the game-mode service. */
export type GameModeServiceOptions = BaseFrontendClassOptions;

/** Options used to construct the idle-detection service. */
export type IdleDetectionServiceOptions = BaseFrontendClassOptions;

/** Options used to construct the local task-pool service. */
export type LocalTaskPoolServiceOptions = BaseFrontendClassOptions;

/** Options used to construct the inventory service. */
export type InventoryServiceOptions = BaseFrontendClassOptions;

/** Options used to construct the NPC schedule service. */
export type NpcScheduleServiceOptions = BaseFrontendClassOptions;

/** Options used to construct the image-generation service. */
export type ImageGenerationServiceOptions = BaseFrontendClassOptions & {
  /** Whether generation uses deterministic demo responses instead of an engine. */
  isDemo: boolean;
};
