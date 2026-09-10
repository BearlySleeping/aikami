// packages/shared/constants/src/lib/contract_pipeline.ts
//
// Shared constants for the automated contract pipeline that are also read by
// Node-side pi extensions. The extension schemas need the default PR base
// branch at registration time, so it cannot come from a bridge subprocess.

/**
 * 🔴 SINGLE SOURCE OF TRUTH: the PR target for every contract pipeline run.
 *
 * Currently `main` — early development, and CodeRabbit only reviews PRs
 * targeting main. Change this one constant (or set CONTRACT_PIPELINE_BASE_BRANCH)
 * to retarget the whole pipeline (e.g. back to `dev` later).
 *
 * The `process` guard keeps this module evaluable in a browser bundle, where
 * `process` does not exist — importing the constants barrel must never throw.
 */
export const PIPELINE_BASE_BRANCH: string =
  typeof process === 'undefined' ? 'main' : (process.env.CONTRACT_PIPELINE_BASE_BRANCH ?? 'main');
