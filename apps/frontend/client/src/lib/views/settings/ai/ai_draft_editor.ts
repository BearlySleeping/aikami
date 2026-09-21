// apps/frontend/client/src/lib/views/settings/ai/ai_draft_editor.ts
//
// Pure editor/draft helpers for the AI settings connection editor: draft
// shape, default params per capability, draft identity for probe invalidation,
// model-test messaging, and unique label allocation. No state, no services.

import type { ImageParams, TextParams, VoiceParams } from '@aikami/types';
import type { ConnectionCapability, ConnectionId } from '$types';
import { DEFAULT_IMAGE_PARAMS } from './ai_image_section';

/** Editor draft state for a new or edited connection. */
export type EditorDraft = {
  providerId: string | undefined;
  registryId: string;
  capability: ConnectionCapability;
  label: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  showApiKey: boolean;
  isEditing: boolean;
  editingConnectionId: ConnectionId | undefined;
};

/** Optional values to prefill when opening the connection editor for a capability. */
export type CapabilitySetupPrefill = {
  registryId: string;
  baseUrl?: string;
  model?: string;
};

/** Ambiguous-key prompt state. */
export type KeyConflictPrompt = {
  /** The new key the user pasted. */
  newKey: string;
  /** The provider whose credential would change. */
  providerLabel: string;
  /** How many connections share this provider. */
  sharedConnectionCount: number;
  /** Whether the user chose to update the shared account. */
  resolveUpdate: boolean;
  /** Whether the user chose to create a separate account. */
  resolveSeparate: boolean;
};

/** Default generation params for a text connection. */
export const DEFAULT_TEXT_PARAMS: TextParams = {
  temperature: 0.7,
  topP: 1,
  topK: 40,
  repetitionPenalty: 1,
  presencePenalty: 0,
  maxTokens: 2048,
  contextSize: 4096,
};

/** Default params for a new connection of the given capability. */
export const defaultParamsForCapability = (
  capability: ConnectionCapability,
): TextParams | ImageParams | VoiceParams => {
  if (capability === 'voice') {
    return { voiceId: '', speed: 1.0, pitch: 0 } as VoiceParams;
  }
  if (capability === 'image') {
    return DEFAULT_IMAGE_PARAMS;
  }
  return { ...DEFAULT_TEXT_PARAMS };
};

/**
 * Identifies the credential/endpoint a draft would probe. A change to any of
 * these invalidates a previous result — a key that verified before the user
 * edited it is not evidence about the new one.
 */
export const draftSignature = (draft: EditorDraft): string =>
  [draft.registryId, draft.apiKey ?? '', draft.baseUrl?.trim() ?? '', draft.providerId ?? ''].join(
    ' ',
  );

/**
 * Explains why a model test has no request to send. Names the actual gap — a
 * missing endpoint — rather than implying the provider is unsupported.
 */
export const modelTestUnavailableError = (
  registryId: string,
  providerModelFetch: Readonly<Record<string, unknown>>,
): string => {
  if (!providerModelFetch[registryId]) {
    return 'Model testing not supported for this provider';
  }
  if (registryId === 'ollama') {
    return 'No local text engine configured (text.url missing from config.json)';
  }
  return 'No endpoint configured — set a base URL';
};

/**
 * Returns a capability-unique label: the requested name as-is when unused,
 * otherwise the next "Name 2", "Name 3", … slot.
 */
export const uniqueConnectionLabel = (
  requested: string,
  usedLabels: Iterable<string | undefined>,
): string => {
  const used = new Set(Array.from(usedLabels).filter((label): label is string => Boolean(label)));
  if (!used.has(requested)) {
    return requested;
  }
  let suffix = 2;
  while (used.has(`${requested} ${suffix}`)) {
    suffix += 1;
  }
  return `${requested} ${suffix}`;
};
