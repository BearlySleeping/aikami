// apps/backend/local-stack/stack/generation/hosted/hosted_reservations.ts
//
// C-524: the durable, atomic hosted cost reservation.
//
// 🔴 A plan-time refusal is not a dispatch-time guard. `enforceGenerationBudget`
// runs in the portable plan, where two processes can both pass the same ceiling
// check before either has written anything. This module re-asserts the
// reservation under the job store's exclusive lock, immediately before the
// outbound request — so the *second* process either finds the existing
// reservation (same request key) or is refused by the budget authority, and in
// neither case makes a second billable call.
//
// A reservation is written *before* the request leaves the process. A process
// that dies mid-request leaves the reservation `reserved`, and the next reader
// resolves that to `unsettled` + `job_reconciliation_required` — never to a
// silent resubmission.
//
// Contract: C-524 Optional hosted asset provider comparison

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type GenerationRunProgress,
  type HostedSettlementOutcome,
  reserveHostedCost,
  settleHostedCost,
} from '@aikami/local-ai';
import { CostReservationSchema } from '@aikami/schemas';
import type {
  CostReservation,
  GenerationBudget,
  GenerationPlanBlocker,
  HostedPreflightQuote,
} from '@aikami/types';
import { Value } from 'typebox/value';
import type { GenerationStorePaths } from '../job_store.ts';
import { readJsonIfPresent, withExclusiveLock, writeJsonAtomic } from '../job_store.ts';

/** Every path the hosted cost store owns for one run. */
export type HostedStorePaths = {
  readonly dir: string;
  readonly reservationsDir: string;
  readonly requestIndexDir: string;
  readonly lockPath: string;
};

/** Derives the hosted cost store layout for one run. */
export const hostedStorePaths = (paths: GenerationStorePaths): HostedStorePaths => {
  const dir = join(paths.runDir, 'hosted');
  return {
    dir,
    reservationsDir: join(dir, 'reservations'),
    requestIndexDir: join(dir, 'by-request'),
    lockPath: join(dir, 'reservations.lock'),
  };
};

/** The reservation file path for an id. */
const reservationPath = (paths: HostedStorePaths, reservationId: string): string =>
  join(paths.reservationsDir, `${encodeURIComponent(reservationId)}.json`);

/** The request-key index path (encoded — keys contain separators). */
const requestIndexPath = (paths: HostedStorePaths, requestKey: string): string =>
  join(paths.requestIndexDir, `${encodeURIComponent(requestKey)}.json`);

/** Reads one reservation, validating it. */
export const readReservation = (options: {
  paths: HostedStorePaths;
  reservationId: string;
}): CostReservation | undefined => {
  const raw = readJsonIfPresent<unknown>(reservationPath(options.paths, options.reservationId));
  return raw !== undefined && Value.Check(CostReservationSchema, raw)
    ? (raw as CostReservation)
    : undefined;
};

/**
 * The reservation already taken for a request key, if any.
 *
 * This is the index AC-3 rests on: a repeated request key resolves to the
 * existing reservation, so the retry makes no second billable call.
 */
export const findReservationByRequestKey = (options: {
  paths: HostedStorePaths;
  requestKey: string;
}): CostReservation | undefined => {
  const indexed = readJsonIfPresent<{ reservationId?: unknown }>(
    requestIndexPath(options.paths, options.requestKey),
  );
  const reservationId = indexed?.reservationId;
  if (typeof reservationId !== 'string' || reservationId.length === 0) {
    return undefined;
  }
  return readReservation({ paths: options.paths, reservationId });
};

/** Every reservation in the store, in id order. */
export const listReservations = (paths: HostedStorePaths): readonly CostReservation[] => {
  if (!existsSync(paths.reservationsDir)) {
    return [];
  }
  return readdirSync(paths.reservationsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const raw = readJsonIfPresent<unknown>(join(paths.reservationsDir, name));
      return raw !== undefined && Value.Check(CostReservationSchema, raw)
        ? (raw as CostReservation)
        : undefined;
    })
    .filter((entry): entry is CostReservation => entry !== undefined);
};

/** The outcome of reserving a dispatch. */
export type HostedDispatchReservation =
  | { readonly kind: 'reserved'; readonly reservation: CostReservation }
  | { readonly kind: 'existing'; readonly reservation: CostReservation }
  | { readonly kind: 'refused'; readonly blocker: GenerationPlanBlocker };

/**
 * Reserves the quote's ceiling for one job, atomically, before dispatch.
 *
 * The whole operation — the request-key lookup, the budget decision and the
 * write — runs under the store's exclusive lock, so two processes cannot both
 * pass the same ceiling check and both dispatch.
 */
export const reserveHostedDispatch = async (options: {
  paths: GenerationStorePaths;
  quote: HostedPreflightQuote;
  reservationId: string;
  jobId: string;
  requestKey: string;
  budget: GenerationBudget;
  progress: GenerationRunProgress;
  itemId: string;
  itemCandidateLimit: number;
  attempt: number;
  at: string;
}): Promise<HostedDispatchReservation> => {
  const hosted = hostedStorePaths(options.paths);
  return withExclusiveLock({ path: hosted.lockPath }, () => {
    const existing = findReservationByRequestKey({
      paths: hosted,
      requestKey: options.requestKey,
    });
    if (existing !== undefined) {
      return { kind: 'existing', reservation: existing };
    }

    const reserved = reserveHostedCost({
      quote: options.quote,
      reservationId: options.reservationId,
      jobId: options.jobId,
      requestKey: options.requestKey,
      budget: options.budget,
      progress: options.progress,
      itemId: options.itemId,
      itemCandidateLimit: options.itemCandidateLimit,
      attempt: options.attempt,
      at: options.at,
    });
    if (reserved.kind === 'refused') {
      return reserved;
    }

    mkdirSync(hosted.reservationsDir, { recursive: true });
    mkdirSync(hosted.requestIndexDir, { recursive: true });
    writeJsonAtomic(
      reservationPath(hosted, reserved.reservation.reservationId),
      reserved.reservation,
    );
    writeJsonAtomic(requestIndexPath(hosted, options.requestKey), {
      reservationId: reserved.reservation.reservationId,
      jobId: options.jobId,
      at: options.at,
    });
    return reserved;
  });
};

/**
 * Settles a reservation under the same exclusive lock.
 *
 * A settlement is a fact about money, so it is serialized exactly like the
 * reservation itself. An `unknown` outcome is written as `unsettled` and the
 * record stays readable — a rollback may not delete a reservation whose
 * billable outcome is unresolved.
 */
export const settleHostedDispatch = async (options: {
  paths: GenerationStorePaths;
  reservation: CostReservation;
  outcome: HostedSettlementOutcome;
  at: string;
}): Promise<CostReservation> => {
  const hosted = hostedStorePaths(options.paths);
  return withExclusiveLock({ path: hosted.lockPath }, () => {
    const settled = settleHostedCost({
      reservation: options.reservation,
      outcome: options.outcome,
      at: options.at,
    });
    mkdirSync(hosted.reservationsDir, { recursive: true });
    writeJsonAtomic(reservationPath(hosted, settled.reservationId), settled);
    return settled;
  });
};

/**
 * Re-reads every reservation that is still unresolved.
 *
 * Used by the run report so an auditable, unsettled spend is visible rather
 * than silently forgotten.
 */
export const unsettledReservations = (paths: HostedStorePaths): readonly CostReservation[] =>
  listReservations(paths).filter((reservation) => reservation.state !== 'settled');

/** Reads a reservation file's raw bytes (used by tests to prove durability). */
export const reservationFileExists = (options: {
  paths: HostedStorePaths;
  reservationId: string;
}): boolean => existsSync(reservationPath(options.paths, options.reservationId));

/** Reads a reservation file's raw JSON text (test/diagnostic seam). */
export const readReservationRaw = (options: {
  paths: HostedStorePaths;
  reservationId: string;
}): string | undefined => {
  const path = reservationPath(options.paths, options.reservationId);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};
