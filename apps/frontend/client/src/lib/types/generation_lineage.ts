// apps/frontend/client/src/lib/types/generation_lineage.ts
//
// C-518 — the lineage a *client* registration hands to the local write seam.
//
// This lives in `$types` rather than beside the registration service for the
// same reason `community_assets.ts` does: `guard-orphaned-capability` treats an
// export referenced only from type positions as having no production caller,
// and the service modules are limited to their own interface/options/singleton.
// The seam's option type is a client-app type, so it belongs here.
//
// Contract: C-518 Generation provenance and candidate records

import type { CandidateStatus, GenerationProvenance } from '@aikami/types';

/**
 * The durable lineage a registration persists alongside the registry row.
 *
 * The seam derives the fields that must never be hand-assembled: the record
 * version, the immutable candidate id (content-addressed on tag + prepared
 * hash) and the transformation-chain hash an acceptance binds to.
 */
export type GeneratedAssetLineage = {
  /** The private record, minus the fields the seam derives. */
  provenance: Omit<
    GenerationProvenance,
    'schemaVersion' | 'candidateId' | 'jobId' | 'tag' | 'provenanceState'
  >;
  /** Candidate review state. Defaults to `pending_review` — accepting is a decision. */
  status?: CandidateStatus;
  /** Opaque C-519 job link, when one exists. */
  jobId?: string;
  /** The candidate this one explicitly supersedes, when it is a revision. */
  revisionOf?: string;
  /** Hash of the validation report an acceptance rests on. */
  validationReportHash?: string;
  /** When the acceptance was granted. Required when `status` is `accepted`. */
  acceptedAt?: string;
};
