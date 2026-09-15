// packages/shared/types/src/lib/generation/runner_dispatch.ts
//
// C-522: Static-derived types for the Hub ↔ runner pairing/dispatch protocol.
// Derived from `@aikami/schemas` per the Schema-First law — there is no
// hand-written duplicate of any shape in `runner_dispatch.ts`.
//
// Contract: C-522 Hub and client access to the generation runner

import type {
  CandidateReviewRequestSchema,
  GenerationArtifactTicketSchema,
  GenerationArtifactTicketViewSchema,
  GenerationCandidateViewSchema,
  GenerationDispatchFenceSchema,
  GenerationDispatchRejectionSchema,
  GenerationDispatchSchema,
  GenerationDispatchSpecSchema,
  PairedRunnerSchema,
  RunnerCancelSignalSchema,
  RunnerCandidateReportSchema,
  RunnerClaimRequestSchema,
  RunnerClaimResponseSchema,
  RunnerDeviceSummarySchema,
  RunnerPairingCodeRecordSchema,
  RunnerPairRequestSchema,
  RunnerPairResponseSchema,
  RunnerStatusUpdateResponseSchema,
  RunnerStatusUpdateSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type PairedRunner = Static<typeof PairedRunnerSchema>;
export type RunnerDeviceSummary = Static<typeof RunnerDeviceSummarySchema>;
export type RunnerPairingCodeRecord = Static<typeof RunnerPairingCodeRecordSchema>;

export type GenerationDispatchSpec = Static<typeof GenerationDispatchSpecSchema>;
export type GenerationDispatch = Static<typeof GenerationDispatchSchema>;
export type GenerationDispatchFence = Static<typeof GenerationDispatchFenceSchema>;
export type GenerationDispatchRejection = Static<typeof GenerationDispatchRejectionSchema>;

export type RunnerPairRequest = Static<typeof RunnerPairRequestSchema>;
export type RunnerPairResponse = Static<typeof RunnerPairResponseSchema>;
export type RunnerClaimRequest = Static<typeof RunnerClaimRequestSchema>;
export type RunnerClaimResponse = Static<typeof RunnerClaimResponseSchema>;
export type RunnerStatusUpdate = Static<typeof RunnerStatusUpdateSchema>;
export type RunnerStatusUpdateResponse = Static<typeof RunnerStatusUpdateResponseSchema>;
export type RunnerCancelSignal = Static<typeof RunnerCancelSignalSchema>;

export type RunnerCandidateReport = Static<typeof RunnerCandidateReportSchema>;
export type GenerationCandidateView = Static<typeof GenerationCandidateViewSchema>;
export type CandidateReviewRequest = Static<typeof CandidateReviewRequestSchema>;

export type GenerationArtifactTicket = Static<typeof GenerationArtifactTicketSchema>;
export type GenerationArtifactTicketView = Static<typeof GenerationArtifactTicketViewSchema>;

export type {
  GenerationArtifactKind,
  GenerationCandidateStatus,
  GenerationDispatchRejectionCode,
  GenerationRunnerAvailability,
  GenerationRunnerMode,
  GenerationRunnerUnavailableCode,
  RunnerPlatform,
} from '@aikami/schemas';
