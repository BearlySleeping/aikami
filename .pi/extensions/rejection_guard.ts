// .pi/extensions/rejection_guard.ts
//
// 🔴 WORKAROUND for a third-party race, not a fix. Remove once pi-deepinfra
// ships a corrected billing footer.
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

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Substring identifying pi's stale-context error (runner.ts `staleMessage`). */
const STALE_CTX_MARKER = 'extension ctx is stale';

/** Installed once per process, even though pi may construct the extension twice. */
let installed = false;

export default function (_pi: ExtensionAPI) {
  if (installed) {
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
        `[rejection-guard] Ignored stale-ctx rejection during teardown (known pi-deepinfra footer race).\n`,
      );
      return;
    }

    // Not ours — restore the default behaviour we displaced by registering
    // this listener at all. Throwing here surfaces as an uncaughtException
    // and aborts the process, which is what Node would have done unaided.
    throw reason;
  });
}
