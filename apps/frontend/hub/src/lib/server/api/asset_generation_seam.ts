// apps/frontend/hub/src/lib/server/api/asset_generation_seam.ts
//
// C-513 AC-9 — the generation/publication seam.
//
// 🔴 STUB UNTIL C-522 LANDS. C-522 (`draft`) owns the private Hub generation
// runner. This module is the *seam* it will fill in: a completed generation job
// records a candidate and stops. Job completion, candidate acceptance and
// community publication are three separate decisions, and collapsing them
// would make every private generation an implicit publication.
//
// There is deliberately no publish call here, and no `autoPublish` branch that
// could grow one by accident: publishing is only ever reachable through the
// explicit reserve/upload route in `asset_community.ts`.

import { logger } from '$logger';

/** A finished private generation job (C-522's shape, stubbed). */
export type GenerationJobCompletion = {
  /** C-522's job id. */
  jobId: string;
  /** The account the job ran for. */
  ownerAccountId: string;
  /** How many candidates the job produced (candidates are not publications). */
  candidateCount: number;
};

/**
 * Record a completed private generation job.
 *
 * Never publishes: a candidate is a local/Hub-private result until the owner
 * explicitly publishes it.
 */
export const recordGenerationJobCompletion = (
  completion: GenerationJobCompletion,
): { published: 0 } => {
  logger.info('asset:generation job completed (private — not published)', {
    jobId: completion.jobId,
    ownerAccountId: completion.ownerAccountId,
    candidateCount: completion.candidateCount,
  });
  return { published: 0 };
};
