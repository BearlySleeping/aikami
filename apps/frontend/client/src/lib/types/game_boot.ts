// apps/frontend/client/src/lib/types/game_boot.ts
//
// Boot pipeline types for the cancellable, observable, content-driven /game boot.
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

/** Ordered boot stages. Order is the pipeline order. */
export type GameBootStage =
  | 'idle'
  | 'loading_campaign'
  | 'validating_save'
  | 'preloading_content'
  | 'creating_engine'
  | 'hydrating_snapshot'
  | 'spawning_entities'
  | 'ready'
  | 'failed'
  | 'cancelled';

/** Reactive boot progress exposed to the ViewModel layer. */
export type GameBootProgress = {
  stage: GameBootStage;
  stageIndex: number;
  stageCount: number;
  detail?: string;
  error?: string;
  failedStage?: GameBootStage;
};

/** Terminal result of one boot attempt. */
export type GameBootResult =
  | { outcome: 'ready'; renderer: 'webgpu' | 'webgl' }
  | { outcome: 'failed'; stage: GameBootStage; error: string }
  | { outcome: 'cancelled' };

/** Inputs assembled by the composition root before boot starts. */
export type GameBootInput = {
  campaignId?: string;
  contentPackId: string;
  personaId?: string;
  pendingSavePayload?: string;
  canvas: HTMLCanvasElement;
  rendererPreference?: 'webgpu' | 'webgl';
};
