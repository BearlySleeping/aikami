// .pi/extensions/rejection_guard.ts
//
// 🔴 WORKAROUND for a third-party race, not a fix. It removes itself once the
// dependency moves past the version it was written for.
//
// pi-deepinfra@0.1.3's footer does this in its session_start handler
// (billing.ts:161-165):
//
//     async onSessionStart(ctx) {
//       if (isActiveProvider(ctx)) await refreshMonthly(ctx);  // network call
//       render(ctx);                                            // ctx may be stale
//     }
//
// `refreshMonthly` hits DeepInfra's /payment/usage endpoint. In headless
// (`-p`) runs the session can finish and be torn down while that request is
// still in flight, so the `ctx` captured before the await is dead by the time
// `render` touches `ctx.model`. pi throws "extension ctx is stale…", and
// because index.ts fires the handler as `void footer.onSessionStart(ctx)` the
// rejection is unhandled. Node's default is to abort the process.
//
// That matters here because the contract pipeline runs headless stages
// (herdr_adapter `_useJsonMode`) and worker/run.ts propagates pi's exit code:
// a slow billing request turns a perfectly good stage into an exit-1 failure.
// It is intermittent — it reproduces only when the fetch loses the race — so
// it reads as random pipeline flakiness rather than a bug with a cause.
//
// This guard swallows ONLY that specific teardown error. Every other
// unhandled rejection is re-raised so Node's crash semantics are preserved;
// silencing them broadly would hide real defects, which is worse than the
// problem being worked around.
//
// Supported mode: Node's DEFAULT unhandled-rejection mode (throw). This
// extension is only correct when the process runs with the default
// `--unhandled-rejections=throw` (or unset, which is the same). It is NOT
// compatible with `--unhandled-rejections=warn` or `=strict`: under `warn`
// the rethrow below would surface as an uncaughtException and abort the
// process (the same crash we are trying to avoid), and under `strict` the
// semantics differ. Do not set NODE_OPTIONS to a non-default rejection mode
// for processes that load this extension. The stale-context suppression and
// rethrow behavior below are correct under the documented default.
//
// ── Why it expires itself ────────────────────────────────────────────────
//
// A workaround with no expiry becomes permanent infrastructure, and the next
// person to debug a swallowed rejection has to reverse-engineer whether it is
// still needed. So the version it was written for is recorded here, read back
// from `.pi/resource-manifest.json` at load time, and compared:
//
//   • recorded version ≤ INTRODUCED_FOR → install the handler (the race exists);
//   • recorded version >  INTRODUCED_FOR → do NOT install it, and say so loudly.
//
// That is the whole mechanism: an upgrade removes the workaround rather than
// leaving a silent handler behind. If the manifest cannot be read, the handler
// is installed (conservative) — a missing manifest must not reintroduce the
// flakiness this exists to absorb.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Substring identifying pi's stale-context error (runner.ts `staleMessage`). */
const STALE_CTX_MARKER = 'extension ctx is stale';

/**
 * The workaround's lifetime contract. Every field is required: a workaround
 * without a package, a version, an owner and a deadline is not a workaround,
 * it is undocumented behaviour.
 */
export const WORKAROUND = {
  /** The dependency whose bug is being absorbed. */
  package: 'pi-deepinfra',
  /** The version the race was diagnosed in; the workaround is for this and earlier. */
  introducedFor: '0.1.3',
  /** Date by which this should be re-reviewed even if the version has not moved. */
  reviewBy: '2027-03-31',
  /** Where the report lives, if one was filed upstream. */
  upstream: 'none filed — the bug is in pi-deepinfra billing.ts:161-165',
  /** What to do when the workaround is removed. */
  removalNote:
    'Delete this extension and its entry from .pi/settings.json once pi-deepinfra no longer renders from a stale ctx.',
} as const;

/**
 * Dotted numeric comparison.
 *
 * 🔴 A segment that is not purely numeric (a prerelease tag like `0.1.4-beta.1`)
 * makes the whole comparison UNKNOWN, and the caller treats unknown as "still
 * needed". `Number.parseInt('4-beta')` would happily return `4`, which would
 * read a prerelease of the next version as newer than the affected one and
 * silently uninstall the workaround before the fix actually shipped.
 */
export const compareVersions = (a: string, b: string): number => {
  const parse = (version: string): number[] | undefined => {
    const parts = version.split('.');
    if (!parts.every((part) => /^\d+$/.test(part))) {
      return undefined;
    }
    return parts.map((part) => Number(part));
  };

  const left = parse(a);
  const right = parse(b);
  if (left === undefined || right === undefined) {
    return 0;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l !== r) {
      return l - r;
    }
  }
  return 0;
};

/** True when the installed version is still inside the affected range. */
export const isWorkaroundStillNeeded = (installedVersion: string | undefined): boolean => {
  if (installedVersion === undefined) {
    // Unknown version: install the handler. Being wrong here means one more
    // swallowed stale-ctx rejection; being wrong the other way means the
    // intermittent pipeline failure this exists to absorb comes back.
    return true;
  }
  return compareVersions(installedVersion, WORKAROUND.introducedFor) <= 0;
};

/** Reads the version this repository recorded for the package, if any. */
export const recordedVersion = (): string | undefined => {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../resource-manifest.json'), 'utf8'),
    ) as { resources?: Record<string, { source?: { version?: string } }> };
    return manifest.resources?.[WORKAROUND.package]?.source?.version;
  } catch {
    return undefined;
  }
};

/** Installed once per process, even though pi may construct the extension twice. */
let installed = false;

export default function (_pi: ExtensionAPI) {
  if (installed) {
    return;
  }

  const version = recordedVersion();
  if (!isWorkaroundStillNeeded(version)) {
    process.stderr.write(
      `[rejection-guard] NOT installing: ${WORKAROUND.package} is at ${version}, past the ` +
        `${WORKAROUND.introducedFor} this workaround was written for.\n` +
        `[rejection-guard] ${WORKAROUND.removalNote}\n` +
        `[rejection-guard] Upstream: ${WORKAROUND.upstream}\n`,
    );
    return;
  }

  installed = true;

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);

    if (message.includes(STALE_CTX_MARKER)) {
      // Benign: a footer/statusline handler outlived its session. The work the
      // session was actually asked to do has already completed and been
      // written out. Report it rather than hiding it, then carry on.
      process.stderr.write(
        `[rejection-guard] Ignored stale-ctx rejection during teardown (known ${WORKAROUND.package} footer race).\n`,
      );
      return;
    }

    // Not ours — restore the default behaviour we displaced by registering
    // this listener at all. Throwing here surfaces as an uncaughtException
    // and aborts the process, which is what Node would have done unaided.
    throw reason;
  });
}
