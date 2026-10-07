// apps/frontend/client/src/lib/views/settings/ai/ai_connection_writer.ts
//
// Writing a connection editor's draft to configuration: the create path and
// the edit path, each deciding which provider ACCOUNT the draft lands on.
//
// This lives apart from the ViewModel because it is a decision, not
// presentation: given a draft and the stored providers, which row does it
// belong to, and what is written. The ViewModel owns the verification gate
// that has to pass before either path runs, and the result bookkeeping
// (test results, capability default) that follows.
//
// Every side effect goes through the `config` port, so the resolution is
// exercisable without a store.

import type {
  AiConnection,
  AiProvider,
  DecisionParams,
  ImageParams,
  TextParams,
  VoiceParams,
} from '@aikami/types';
import {
  defaultParamsForCapability,
  type EditorDraft,
  uniqueConnectionLabel,
} from './ai_draft_editor';
import {
  hasMovedAccount,
  type ProviderAccountFields,
  planProviderAccount,
} from './ai_provider_account';
import { registryLabel } from './ai_provider_registry';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/** The configuration surface both write paths need. */
export type ConnectionWriteConfig = {
  getProviders(): readonly AiProvider[];
  getProvider(id: string): AiProvider | undefined;
  addProvider(fields: ProviderAccountFields): string;
  updateProvider(id: string, patch: Partial<Omit<AiProvider, 'id'>>): void;
  getAiConnections(): readonly AiConnection[];
  getAiConnection(id: string): AiConnection | undefined;
  addAiConnection(connection: {
    providerId: string;
    capability: AiConnection['capability'];
    label: string;
    model: string;
    params: TextParams | ImageParams | VoiceParams | DecisionParams;
  }): string;
  updateAiConnection(id: string, patch: Partial<Omit<AiConnection, 'id' | 'createdAt'>>): void;
  setDefaultConnection(connectionId: string): void;
};

/** Everything a write path needs beyond the configuration port. */
export type ConnectionWriteContext = {
  config: ConnectionWriteConfig;
  draft: EditorDraft;
  /** Whether the draft's provider takes a user-supplied URL, making its id non-unique. */
  endpointScoped: boolean;
  /** Generation-parameter edits to fold into the saved row; empty when untouched. */
  genParams: Partial<TextParams>;
  /** Credential to create the account with instead of the draft's key. */
  credentialOverride?: string;
  /** Forces a separate account instead of continuing the stored one. */
  forceSeparate?: boolean;
  /** Whether a capability already has a default connection. */
  isDefaultClaimed: (capability: AiConnection['capability']) => boolean;
  /**
   * Called whenever an account's endpoint or credential changes. The account
   * is shared by every connection on it, so a rotation invalidates the stored
   * results of the sibling rows too (P03 AC-4).
   */
  onAccountChanged: (providerId: string) => void;
};

/** What a write path did — the row it landed on and the account it points at. */
export type ConnectionWriteResult = {
  connectionId: string | undefined;
  providerId: string | undefined;
};

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

/** The fields an account is created from. */
const accountFields = (context: ConnectionWriteContext): ProviderAccountFields => {
  const { credentialOverride, draft } = context;
  return {
    registryId: draft.registryId,
    label: registryLabel(draft.registryId) ?? draft.registryId,
    credential: (credentialOverride ?? draft.apiKey)?.trim() || undefined,
    baseUrl: draft.baseUrl?.trim() || undefined,
    source: 'stored',
  };
};

/** Writes an endpoint/credential edit onto the account a draft continues. */
const patchAccount = (
  context: ConnectionWriteContext,
  provider: AiProvider,
  fields: ProviderAccountFields,
): void => {
  const patch: Partial<Omit<AiProvider, 'id'>> = {};
  if (fields.baseUrl && fields.baseUrl !== provider.baseUrl) {
    patch.baseUrl = fields.baseUrl;
  }
  if (fields.credential && fields.credential !== provider.credential) {
    patch.credential = fields.credential;
  }
  if (Object.keys(patch).length > 0) {
    context.config.updateProvider(provider.id, patch);
    context.onAccountChanged(provider.id);
  }
};

/**
 * The account a draft lands on: the stored one it continues (patched with the
 * draft's endpoint and key), or a freshly created one.
 */
const resolveAccount = (context: ConnectionWriteContext): AiProvider => {
  const fields = accountFields(context);
  const plan = planProviderAccount({
    providers: context.config.getProviders(),
    registryId: context.draft.registryId,
    baseUrl: context.draft.baseUrl,
    apiKey: fields.credential,
    endpointScoped: context.endpointScoped,
    forceSeparate: context.forceSeparate,
  });
  if (plan.existing) {
    patchAccount(context, plan.existing, fields);
    return plan.existing;
  }
  const id = context.config.addProvider(fields);
  return context.config.getProvider(id) ?? { id, ...fields };
};

// ---------------------------------------------------------------------------
// Row fields
// ---------------------------------------------------------------------------

/** A capability-unique label for a new connection, or the requested one when editing. */
const connectionLabel = (context: ConnectionWriteContext): string => {
  const { config, draft } = context;
  const requested = draft.label?.trim() || registryLabel(draft.registryId) || draft.registryId;
  if (draft.isEditing) {
    return requested;
  }
  return uniqueConnectionLabel(
    requested,
    config
      .getAiConnections()
      .filter((connection) => connection.capability === draft.capability)
      .map((connection) => connection.label?.trim()),
  );
};

/** Generation params for a saved text row, folded over the capability defaults. */
const paramsFor = (
  context: ConnectionWriteContext,
): TextParams | ImageParams | VoiceParams | DecisionParams => {
  const defaults = defaultParamsForCapability(context.draft.capability);
  if (context.draft.capability !== 'text' || Object.keys(context.genParams).length === 0) {
    return defaults;
  }
  return { ...(defaults as TextParams), ...context.genParams } as TextParams;
};

// ---------------------------------------------------------------------------
// Write paths
// ---------------------------------------------------------------------------

/** Writes a NEW connection: resolves its account, adds the row, claims the default. */
export const writeNewConnection = (context: ConnectionWriteContext): ConnectionWriteResult => {
  const { capability } = context.draft;
  const provider = resolveAccount(context);
  const connectionId = context.config.addAiConnection({
    providerId: provider.id,
    capability,
    label: connectionLabel(context),
    model: context.draft.model,
    params: paramsFor(context),
  });
  if (!context.isDefaultClaimed(capability)) {
    context.config.setDefaultConnection(connectionId);
  }
  return { connectionId, providerId: provider.id };
};

/**
 * Writes an EDITED connection in place.
 *
 * The provider the editor shows must actually repoint the saved row: when the
 * type changed, and when a user-supplied endpoint moved — an endpoint-scoped
 * account is only an account for as long as that URL holds, so retyping it
 * moves the connection instead of rewriting what its siblings share.
 */
export const writeEditedConnection = (
  context: ConnectionWriteContext & { connectionId: string },
): ConnectionWriteResult => {
  const { config, draft } = context;
  const connection = config.getAiConnection(context.connectionId);
  if (!connection) {
    return { connectionId: undefined, providerId: undefined };
  }

  const current = config.getProvider(connection.providerId);
  const moved = hasMovedAccount({
    current,
    registryId: draft.registryId,
    baseUrl: draft.baseUrl,
    endpointScoped: context.endpointScoped,
  });
  if (current && !moved) {
    // Editing in place: the row keeps its account, and the endpoint/credential
    // edit lands on that account.
    patchAccount(context, current, accountFields(context));
  }
  const provider = moved ? resolveAccount(context) : current;

  const patch: Partial<Omit<AiConnection, 'id' | 'createdAt'>> = {
    label: connectionLabel(context),
    model: draft.model,
  };
  if (provider && provider.id !== connection.providerId) {
    patch.providerId = provider.id;
  }
  // Generation params are written ONLY when the Advanced disclosure was
  // actually edited — opening it alone must never write a default value into a
  // connection that never had one.
  if (connection.capability === 'text' && Object.keys(context.genParams).length > 0) {
    patch.params = { ...(connection.params as TextParams), ...context.genParams } as TextParams;
  }
  config.updateAiConnection(context.connectionId, patch);
  return { connectionId: context.connectionId, providerId: provider?.id };
};
