// apps/backend/local-stack/stack/generation/hosted/hosted_evidence.ts
//
// C-524: turns the flat metadata a hosted engine reports into the durable
// evidence record a hosted candidate carries.
//
// 🔴 The evidence is recorded, never inferred. If the provider reported no
// request id, there is no evidence record at all — a hosted candidate with a
// fabricated identity is a defect, and the adapter refuses before this point.
// A wall time is carried only with the named hardware that measured it.
//
// Contract: C-524 Optional hosted asset provider comparison

import {
  type GenerationHostedTransportId,
  HOSTED_TRANSPORT_TERMS,
  hostedTermsRightsScopes,
  isGenerationHostedTransportId,
} from '@aikami/constants';
import type {
  GenerationJobRecord,
  HostedProviderAccountScope,
  HostedRequestEvidence,
  RightsDecision,
} from '@aikami/types';

/** The flat metadata keys the hosted engine sets on a `GenerationResult`. */
export const HOSTED_METADATA_KEYS = {
  requestId: 'hosted.requestId',
  endpoint: 'hosted.endpoint',
  limitation: 'hosted.limitation',
  modelId: 'hosted.modelId',
  apiVersion: 'hosted.apiVersion',
  wallTimeMs: 'hosted.wallTimeMs',
  measuredOn: 'hosted.measuredOn',
  actualUsd: 'hosted.actualUsd',
} as const;

/** Reads a non-empty string metadata entry. */
const metadataString = (
  metadata: Readonly<Record<string, string | number>>,
  key: string,
): string | undefined => {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** Reads a finite numeric metadata entry. */
const metadataNumber = (
  metadata: Readonly<Record<string, string | number>>,
  key: string,
): number | undefined => {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/**
 * Builds the durable hosted evidence for one finished job.
 *
 * @returns `undefined` for a local job, or for a hosted job whose engine
 *          reported no request id — an absence that is honest, because a
 *          hosted candidate without a request id was refused upstream.
 */
export const hostedEvidenceForJob = (options: {
  providerMode: string;
  engineId: string | undefined;
  engineMetadata: Readonly<Record<string, string | number>> | undefined;
  rawHash: string;
  preparedHash: string;
  providerProfileId: string;
}): HostedRequestEvidence | undefined => {
  if (options.providerMode !== 'hosted') {
    return undefined;
  }
  if (!isGenerationHostedTransportId(options.engineId)) {
    return undefined;
  }
  const metadata = options.engineMetadata;
  if (metadata === undefined) {
    return undefined;
  }
  const requestId = metadataString(metadata, HOSTED_METADATA_KEYS.requestId);
  const modelId = metadataString(metadata, HOSTED_METADATA_KEYS.modelId);
  const apiVersion = metadataString(metadata, HOSTED_METADATA_KEYS.apiVersion);
  const measuredOn = metadataString(metadata, HOSTED_METADATA_KEYS.measuredOn);
  if (
    requestId === undefined ||
    modelId === undefined ||
    apiVersion === undefined ||
    measuredOn === undefined
  ) {
    return undefined;
  }
  const limitation = metadataString(metadata, HOSTED_METADATA_KEYS.limitation);
  return {
    providerProfileId: options.providerProfileId,
    transport: options.engineId,
    requestId,
    modelId,
    apiVersion,
    endpoint: metadataString(metadata, HOSTED_METADATA_KEYS.endpoint) ?? 'provider-api',
    rawHash: options.rawHash,
    preparedHash: options.preparedHash,
    wallTimeMs: metadataNumber(metadata, HOSTED_METADATA_KEYS.wallTimeMs) ?? 0,
    measuredOn,
    responseMetadata: {
      ...(limitation === undefined ? {} : { limitation }),
      ...(metadataString(metadata, 'content-type') === undefined
        ? {}
        : { contentType: metadataString(metadata, 'content-type') as string }),
    },
  };
};

/**
 * The provider account/terms record in force for one hosted dispatch.
 *
 * 🔴 Recorded without a credential: the account/plan scope, the terms revision
 * and date, the pinned model/API version and the provider's non-secret response
 * metadata. It is what lets a reader answer "under which terms was this
 * produced" after the credential has expired.
 */
export const hostedAccountScopeForJob = (options: {
  transport: GenerationHostedTransportId;
  providerProfileId: string;
  modelId: string;
  apiVersion: string;
  responseMetadata: Readonly<Record<string, string>>;
}): HostedProviderAccountScope => {
  const terms = HOSTED_TRANSPORT_TERMS[options.transport];
  return {
    providerProfileId: options.providerProfileId,
    transport: options.transport,
    accountScope: terms.accountScope,
    termsRevision: terms.revision,
    termsDate: terms.date,
    modelId: options.modelId,
    apiVersion: options.apiVersion,
    responseMetadata: { ...options.responseMetadata },
  };
};

/**
 * The scoped rights the recorded terms grant for a hosted candidate.
 *
 * 🔴 Produced from `hostedTermsRightsScopes`, the *single* declaration of what
 * each provider's terms permit — so the same three scopes the C-513 publication
 * gate evaluates are the ones recorded here. An API key proves API access, not
 * a redistribution licence, so `standaloneDistribution` stays denied and the
 * shipped gate blocks an export of the candidate on that scope.
 */
export const hostedRightsForTransport = (
  transport: GenerationHostedTransportId,
): RightsDecision => {
  const scopes = hostedTermsRightsScopes(transport);
  const decision = (permitted: boolean) => ({
    permitted,
    state: permitted ? ('allowed' as const) : ('denied' as const),
  });
  return {
    inference: decision(scopes.inference),
    gameInclusion: decision(scopes.gameInclusion),
    standaloneDistribution: decision(scopes.standaloneDistribution),
  };
};

/**
 * The durable hosted patch for one finished job.
 *
 * One call, one spread: the evidence, the account/terms record and the scoped
 * rights all come from the same dispatch, so a job cannot carry one without the
 * others. A non-hosted job, or a hosted job whose engine reported no request
 * id, gets an empty patch — an absence that is honest.
 */
export const hostedRecordPatchForJob = (options: {
  providerMode: string;
  engineId: string | undefined;
  engineMetadata: Readonly<Record<string, string | number>> | undefined;
  rawHash: string;
  preparedHash: string;
  providerProfileId: string;
}): Partial<
  Pick<GenerationJobRecord, 'hostedEvidence' | 'hostedAccountScope' | 'hostedRights'>
> => {
  const evidence = hostedEvidenceForJob(options);
  if (evidence === undefined) {
    return {};
  }
  return {
    hostedEvidence: evidence,
    hostedAccountScope: hostedAccountScopeForJob({
      transport: evidence.transport,
      providerProfileId: options.providerProfileId,
      modelId: evidence.modelId,
      apiVersion: evidence.apiVersion,
      responseMetadata: evidence.responseMetadata,
    }),
    hostedRights: hostedRightsForTransport(evidence.transport),
  };
};
