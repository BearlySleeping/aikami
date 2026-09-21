// packages/frontend/engine/src/worker/worker_protocol.ts
//
// Typed boundary between the main thread and the bitECS simulation worker.
//
// The main thread only ever consumes the `WorkerMessage` discriminated
// union below, and the worker echoes the optional `requestId` it received on
// every terminal response so {@link import('../game_world/worker_session.ts').WorkerSession}
// can settle the matching request. Unsolicited messages (boot ENGINE_READY,
// per-tick STATE_UPDATE, ENTITY_CREATED) carry no requestId.
//
// This module is pure types + small guards — no PixiJS, no bitECS, no
// runtime state — so both the worker graph and the render graph can import it.

import type { GameEvent } from '../types.ts';

/**
 * Correlation id minted by the main thread and echoed by the worker.
 *
 * `undefined` on unsolicited messages.
 */
export type WorkerRequestId = number;

/** Structured-clone-safe environment snapshot attached to STATE_UPDATE. */
export type WorkerEnvironmentSnapshot = {
  gameHour: number;
  gameMinute: number;
  gameTimeSeconds: number;
  windVelocity: number;
  rainIntensity: number;
  ubo?: Float32Array;
};

/** Worker liveness counters echoed on every STATE_UPDATE. */
export type WorkerAck = {
  tickCount?: number;
  lastProcessedInputSequence?: number;
  writableBufferCount?: number;
};

/** NPC spawn metadata the worker attaches to ENTITY_CREATED. */
export type WorkerNpcData = {
  eid: number;
  npcId: string;
  npcName: string;
  personaId: string;
  interactionRadius: number;
  relationshipValue: number;
  dialog: string;
  isVendor: boolean;
  vendorInventory: string;
};

/** A worker → main message carrying a transferred entity-state buffer. */
export type StateUpdateMessage = {
  type: 'STATE_UPDATE';
  buffer?: ArrayBuffer;
  events?: GameEvent[];
  tick?: number;
  simTimeMs?: number;
  stepMs?: number;
  cameraX?: number;
  cameraY?: number;
  zoom?: number;
  playerVisibleByMask?: number;
  ack?: WorkerAck;
  environment?: WorkerEnvironmentSnapshot;
  npcScreenX?: number;
  npcScreenY?: number;
};

/** Events-only sync (no buffer swap) — e.g. post-LOAD_MAP appearance batch. */
export type SyncMessage = {
  type: 'SYNC';
  events?: GameEvent[];
};

/** A hydrated entity the main thread must create a display object for. */
export type EntityCreatedMessage = {
  type: 'ENTITY_CREATED';
  eid: number;
  tint?: number;
  npcData?: WorkerNpcData;
  frame?: string;
};

/** Immediate camera snap (after LOAD_GAME / RESTORE_PLAYER). */
export type CameraSnapMessage = {
  type: 'CAMERA_SNAP';
  x?: number;
  y?: number;
};

/** Completion sentinel for initialization and correlated operations. */
export type EngineReadyMessage = {
  type: 'ENGINE_READY';
  requestId?: WorkerRequestId;
};

/** Recoverable error. Correlated when it answers a request. */
export type EngineErrorMessage = {
  type: 'ENGINE_ERROR';
  message?: string;
  requestId?: WorkerRequestId;
};

/** Unrecoverable worker failure — the main thread tears the world down. */
export type EngineFatalMessage = {
  type: 'ENGINE_FATAL';
  message?: string;
};

/** Worker module-evaluation / liveness diagnostics. */
export type WorkerDiagnosticMessage =
  | { type: 'DIAGNOSTIC_PING' }
  | { type: 'DIAGNOSTIC_MODULE_LOADED'; timestamp?: number }
  | { type: 'DIAGNOSTIC_WORKER_EVALUATED'; timestamp?: number };

/** Heartbeat reply. */
export type WorkerPongMessage = {
  type: 'PONG';
  timestamp?: number;
};

/** Completion sentinel for LOAD_MAP. */
export type MapLoadedMessage = {
  type: 'MAP_LOADED';
  requestId?: WorkerRequestId;
};

/** Reply to REQUEST_SNAPSHOT (success or error). */
export type SnapshotResponseMessage = {
  type: 'SNAPSHOT_RESPONSE';
  payload?: string;
  error?: string;
  requestId?: WorkerRequestId;
};

/** Every message the simulation worker can post to the main thread. */
export type WorkerMessage =
  | StateUpdateMessage
  | SyncMessage
  | EntityCreatedMessage
  | CameraSnapMessage
  | EngineReadyMessage
  | EngineErrorMessage
  | EngineFatalMessage
  | WorkerDiagnosticMessage
  | WorkerPongMessage
  | MapLoadedMessage
  | SnapshotResponseMessage;

/** Terminal message types that can settle a correlated request. */
export type WorkerTerminalType =
  | 'SNAPSHOT_RESPONSE'
  | 'ENGINE_READY'
  | 'ENGINE_ERROR'
  | 'MAP_LOADED';

/**
 * Narrows unknown worker data to a {@link WorkerMessage}.
 *
 * The worker and main thread are the same codebase and share the same
 * Vite build, so this intentionally validates only the discriminator — the
 * shape of each variant is fixed by {@link WorkerMessage}. Per-field payload
 * validation happens at the point of use.
 */
export const asWorkerMessage = (value: unknown): WorkerMessage | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') {
    return undefined;
  }
  // guard-ignore lint/type-safety/casting: worker and main share one build; only the
  // discriminator is validated here, per-field validation happens at use.
  return value as WorkerMessage;
};

/** True when `message` is a terminal reply that can settle a request. */
export const isWorkerTerminalMessage = (
  message: WorkerMessage,
): message is Extract<WorkerMessage, { type: WorkerTerminalType }> =>
  message.type === 'SNAPSHOT_RESPONSE' ||
  message.type === 'ENGINE_READY' ||
  message.type === 'ENGINE_ERROR' ||
  message.type === 'MAP_LOADED';

/** True when `message` is a terminal reply to a correlated request. */
export const isCorrelatedReply = (
  message: WorkerMessage,
): message is Extract<WorkerMessage, { requestId?: WorkerRequestId }> =>
  typeof (message as { requestId?: unknown }).requestId === 'number';
