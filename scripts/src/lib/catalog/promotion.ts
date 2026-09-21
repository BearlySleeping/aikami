// scripts/src/lib/catalog/promotion.ts
//
// The production promotion gate.
//
// ── The guarantee ──────────────────────────────────────────────────────────
//
//   production publishes the candidate staging approved — and only that.
//
// ── Why this is a separate module ──────────────────────────────────────────
//
// `checkPromotion` (in `release.ts`) answers the pure question: "does this
// receipt describe a staging approval of this candidate?" It is a function of
// two values and needs no I/O.
//
// This module answers the question that actually gates a production write:
// "is that approval STILL TRUE right now?" A receipt is a file on disk. It can
// be stale, hand-edited, copied from another machine, or describe a staging
// release that has since been superseded or deleted. So the receipt is
// schema-validated, its identity is checked against the canonical staging
// table, and the staging release it names is re-resolved from staging's own
// origin through the SAME hash-verifying resolver the client boot path uses.
//
// ── Ordering ───────────────────────────────────────────────────────────────
//
// Every check here runs BEFORE the first production write. A production
// `--apply` that cannot produce a valid approval never loads write credentials
// and never uploads a byte.
//
// ── What is deliberately NOT required ──────────────────────────────────────
//
// The staging and production catalog ROOTS are not compared. Staging and
// production legitimately carry different unrelated base inventory, so their
// roots differ even when the Emberwatch candidate is byte-identical. Requiring
// root equality would conflate "same candidate" with "same entire global
// catalog graph", which this infrastructure does not guarantee. Candidate
// identity (`candidateLockHash`) is what must match.

import { readFileSync } from 'node:fs';
import { CATALOG_ORIGINS } from '@aikami/constants';
import type { ReleaseDocumentReader, ReleaseReceipt } from '@aikami/schemas';
import { ReleaseReceiptSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { resolvePreviousRelease } from './published_catalog.ts';
import { checkPromotion, type PromotionFailureCode } from './release.ts';

/** Every way a production promotion can be refused. */
export type StagingApprovalFailureCode =
  | 'receipt-absent'
  | 'receipt-malformed'
  | PromotionFailureCode
  | 'staging-release-unresolvable'
  | 'staging-release-mismatch';

export type StagingApproval =
  | {
      ok: true;
      receipt: ReleaseReceipt;
      /** The staging release id the receipt names, re-confirmed remotely. */
      releaseId: string;
      /** The staging root hash the receipt names, re-confirmed remotely. */
      rootHash: string;
    }
  | { ok: false; code: StagingApprovalFailureCode; reason: string };

/**
 * Reads and schema-validates a receipt file.
 *
 * A receipt that exists but does not satisfy `ReleaseReceiptSchema` is
 * MALFORMED, not absent — the two need different remedies, and collapsing them
 * would let a truncated file read as "staging never ran".
 */
export const readStagingReceipt = (
  path: string,
):
  | { ok: true; receipt: ReleaseReceipt }
  | { ok: false; code: 'receipt-absent' | 'receipt-malformed'; reason: string } => {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      ok: false,
      code: 'receipt-absent',
      reason:
        `no staging receipt at ${path} — ${error instanceof Error ? error.message : String(error)}. ` +
        'Publish and verify staging first; production promotes an approved candidate, not a fresh one.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      code: 'receipt-malformed',
      reason: `the staging receipt at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!Value.Check(ReleaseReceiptSchema, parsed)) {
    const first = [...Value.Errors(ReleaseReceiptSchema, parsed)][0];
    return {
      ok: false,
      code: 'receipt-malformed',
      reason:
        `the staging receipt at ${path} failed ReleaseReceiptSchema validation` +
        (first ? ` (${first.instancePath || '/'}: ${first.message})` : ''),
    };
  }

  return { ok: true, receipt: parsed as ReleaseReceipt };
};

/**
 * The full production promotion gate.
 *
 * @param options.receiptPath - `.local/releases/receipt-staging.json`.
 * @param options.candidateLockHash - The candidate production is about to publish.
 * @param options.reader - Reader for the staging origin's release graph.
 *   Injectable so a test never touches a real bucket.
 * @param options.staging - Canonical staging identity. Defaults to the
 *   committed origin table.
 */
export const verifyStagingApproval = async (options: {
  receiptPath: string;
  candidateLockHash: string;
  reader?: ReleaseDocumentReader;
  staging?: { bucketName: string; originUrl: string | null };
}): Promise<StagingApproval> => {
  const staging = options.staging ?? CATALOG_ORIGINS.staging;

  const loaded = readStagingReceipt(options.receiptPath);
  if (!loaded.ok) {
    return { ok: false, code: loaded.code, reason: loaded.reason };
  }
  const { receipt } = loaded;

  // The receipt must describe a staging approval of THIS candidate, naming
  // staging's canonical bucket and origin.
  const shape = checkPromotion({
    stagingReceipt: receipt,
    candidateLockHash: options.candidateLockHash,
    staging,
  });
  if (!shape.ok) {
    return { ok: false, code: shape.code, reason: shape.reason };
  }

  // A receipt is a file. The release it names must still be the one staging
  // actually serves, hash-verified through the client's own resolver.
  if (staging.originUrl === null) {
    return {
      ok: false,
      code: 'staging-release-unresolvable',
      reason:
        'staging has no declared public origin, so the approved release cannot be re-read ' +
        'and the approval cannot be confirmed.',
    };
  }

  let previous: Awaited<ReturnType<typeof resolvePreviousRelease>>;
  try {
    previous = await resolvePreviousRelease({
      originUrl: staging.originUrl,
      ...(options.reader === undefined ? {} : { reader: options.reader }),
    });
  } catch (error) {
    return {
      ok: false,
      code: 'staging-release-unresolvable',
      reason:
        `the staging release at ${staging.originUrl} could not be verified: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!previous) {
    return {
      ok: false,
      code: 'staging-release-unresolvable',
      reason:
        `staging publishes no release pointer at ${staging.originUrl}, so the receipt names ` +
        'a release that is not there.',
    };
  }

  if (previous.releaseId !== receipt.releaseId) {
    return {
      ok: false,
      code: 'staging-release-mismatch',
      reason:
        `the receipt names staging release ${JSON.stringify(receipt.releaseId)} but staging ` +
        `currently serves ${JSON.stringify(previous.releaseId)}. The approval is stale.`,
    };
  }
  if (receipt.catalogRootHash !== '' && previous.rootHash !== receipt.catalogRootHash) {
    return {
      ok: false,
      code: 'staging-release-mismatch',
      reason:
        `the receipt pins staging root ${receipt.catalogRootHash.slice(0, 12)}… but staging ` +
        `serves ${previous.rootHash.slice(0, 12)}…`,
    };
  }

  return { ok: true, receipt, releaseId: previous.releaseId, rootHash: previous.rootHash };
};

/** One line naming the approval, for a plan/apply header. Never secrets. */
export const describeStagingApproval = (approval: {
  releaseId: string;
  rootHash: string;
  receipt: ReleaseReceipt;
}): string =>
  [
    `staging release: ${approval.releaseId}`,
    `staging root:    ${approval.rootHash.slice(0, 12)}…`,
    `candidate:       ${approval.receipt.candidateLockHash}`,
  ].join('\n');
