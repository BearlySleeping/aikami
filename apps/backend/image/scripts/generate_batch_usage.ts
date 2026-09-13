// apps/backend/image/scripts/generate_batch_usage.ts
//
// C-519: the `generate:batch` usage text.
//
// It is a separate module so the CLI stays inside the source-file-size budget
// and so a test can assert the documented flags against the shipped ones
// without importing the CLI's entry point.
//
// Contract: C-519 Durable asset jobs and batch execution

import {
  DEFAULT_BATCH_LEGACY_OUT_DIR_RELATIVE,
  DEFAULT_BATCH_RUNS_DIR_RELATIVE,
} from '@aikami/constants';

export const BATCH_USAGE = `Usage: bun run --cwd apps/backend/image generate:batch --manifest <brief.json> [options]

Required:
  --manifest <path>            The authored asset brief (validated strictly before any side effect).

Modes (exactly one, default --plan):
  --plan                       Derive the machine-readable job plan. No engine call, no download, no staging write.
  --run                        Plan, claim and execute the plan's dispatchable items.
  --resume <runId>             Resume an existing run's unfinished jobs (verified raw bytes are reused).
  --status <runId>             Print a run's durable job, lease and reconciliation state.
  --cancel <runId>             Request cancellation of a run's unfinished jobs.

Options:
  --phase slice|expansion      Brief phase to plan or run (default: the brief's execution.defaultPhase).
  --runs-dir <dir>             Run-record/staging root (default: apps/backend/image/${DEFAULT_BATCH_RUNS_DIR_RELATIVE}).
  --out <dir>                  Legacy generate:asset staging root, read only by --import-legacy
                               (default: apps/backend/image/${DEFAULT_BATCH_LEGACY_OUT_DIR_RELATIVE}).
  --import-legacy              Read pre-existing staging through the explicit validated opt-in (read-only).
  --item <id>                  Restrict --run to one brief item id.
  --variation <n>              Explicit new variation for --item: bumps attempt/seed, consumes candidate budget.
  --provider <profileId>       Force a provider profile instead of the brief's preference group.
  --request-key <key>          Client request key for --item (the idempotency handle).
  --run-id <id>                Explicit run id (default: <briefId>--<phase>).
  --reconcile <itemId>=<provider-completed|provider-cancelled|no-provider-work>
                               Resolve a reconciliation_required job before dispatching (used with --run).
  --root <dir>                 Root that brief reference locators resolve against (default: the repo root).
  --engine-url <url>           Engine base URL override (default: the local-stack image/audio profile).
  --timeout <seconds>          Poll deadline for one generation (default: 900 image, 1800 audio).
  --hosted-budget-usd <n>      Override the brief's hosted spend ceiling.
  --budget-duration <secs>     Total generated-duration ceiling.
  --budget-pixels <n>          Total pixel ceiling.
  --budget-retained-bytes <n>  Retained-bytes ceiling.
  --help                       Print this usage.

Exit codes: 0 ok · 1 internal error · 2 blocked plan · 3 budget refused · 4 invalid invocation · 5 job-state conflict.`;
