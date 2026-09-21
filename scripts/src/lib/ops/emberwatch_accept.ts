// scripts/src/lib/ops/emberwatch_accept.ts
//
// Operator acceptance for a `generate:batch` run.
//
// Generation produces CANDIDATES. Acceptance is a separate, explicit decision:
// this tool installs the machine-passing prepared bytes of a run into the pack's
// authoring source locations and writes a machine-readable acceptance record so
// the lineage (item → candidate → prepared hash → installed path) is auditable
// and a release can prove which bytes were accepted.
//
// It refuses to:
//   • install a candidate whose deterministic preparation did NOT pass the
//     machine gate (`machinePassed: false`) — a rejected candidate is never
//     silently promoted;
//   • overwrite an existing different file unless `--force` is given;
//   • install an item that the pack's binding table does not map to a path.
//
// The work is phased so each refusal names its own reason:
//
//   resolve candidate → validate preparation → resolve target → install → record
//
// Run:
//   bun scripts/src/lib/ops/emberwatch_accept.ts --run <runId> [--apply] [--force]
//
// Default is a dry run that prints exactly what would be installed.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const runsRoot = join(repository, 'apps/backend/image/src/output/runs');
const briefPath = join(repository, 'docs/plans/emberwatch_asset_brief.json');
const packRoot = join(repository, 'content/packs/emberwatch');

type BriefJob = {
  id: string;
  kind: string;
  binding: { kind: string; targetIds: string[]; variant: string | null };
};

type Brief = { id: string; jobs: BriefJob[] };

type Validation = {
  itemId: string;
  rawSha256: string;
  preparedSha256: string;
  report: { machinePassed: boolean; findings: { code: string; severity: string }[] };
};

type MediaValidation = { validations: Validation[] };

type JobRecord = {
  itemId: string;
  status: string;
  candidateId?: string;
  preparedHash?: string;
  stagedPath?: string;
};

type ManifestProps = Record<string, { frame?: string }>;

/** Everything one job needs before its bytes may be installed. */
type EligibleItem = { record: JobRecord; validation: Validation; job: BriefJob };

/** A resolved, guard-cleared install. */
type InstallPlan = {
  record: JobRecord;
  staged: string;
  destination: string;
  stagedHash: string;
  replaced: boolean;
};

/** A plan, or the reason this item is skipped. */
type Planned = { plan: InstallPlan } | { reason: string };

const sha256File = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * Where an accepted item's bytes belong.
 *
 * Derived from the brief's own binding — never a hand-maintained table — so a
 * new job cannot be accepted into a path nobody declared.
 */
const targetPathFor = (job: BriefJob): string | undefined => {
  const target = job.binding.targetIds[0];
  if (target === undefined) {
    return undefined;
  }
  switch (job.binding.kind) {
    case 'npc_portrait':
      return join(packRoot, 'portraits', target, `${job.binding.variant ?? 'neutral'}.png`);
    case 'npc_expression':
      return join(packRoot, 'portraits', target, `${job.binding.variant ?? 'neutral'}.png`);
    case 'prop':
      // A hostile-visual job targets an NPC id; everything else is a prop whose
      // frame the prop table names.
      return job.id.includes('_visual') ? join(packRoot, 'enemies', `${target}.png`) : undefined;
    case 'ending_prop':
      return join(packRoot, 'props', `${job.binding.variant ?? 'state'}.png`);
    default:
      return undefined;
  }
};

/**
 * The prop frame an accepted prop item installs to.
 *
 * Read from the synced prop table in the manifest, so acceptance and the prop
 * atlas can never disagree about the file name.
 */
const propFramePath = (job: BriefJob, manifestProps: ManifestProps): string | undefined => {
  const frame = manifestProps[job.binding.targetIds[0] ?? '']?.frame;
  return frame === undefined ? undefined : join(packRoot, 'props', frame);
};

const destinationFor = (job: BriefJob, manifestProps: ManifestProps): string | undefined =>
  targetPathFor(job) ?? (job.kind === 'prop' ? propFramePath(job, manifestProps) : undefined);

/** An expression variant is only meaningful once its neutral fallback exists. */
const neutralPortraitMissing = (job: BriefJob): boolean => {
  if (job.binding.kind !== 'npc_expression') {
    return false;
  }
  const npcId = job.binding.targetIds[0];
  return npcId === undefined || !existsSync(join(packRoot, 'portraits', npcId, 'neutral.png'));
};

/** Resolves and validates one job record; a non-eligible item carries its reason. */
const eligibleItem = (options: {
  record: JobRecord;
  passedByItem: Map<string, Validation>;
  jobsById: Map<string, BriefJob>;
}): { item: EligibleItem } | { reason: string } => {
  const { record, passedByItem, jobsById } = options;
  if (record.status !== 'awaiting_review') {
    return { reason: `job status ${record.status}` };
  }
  const validation = passedByItem.get(record.itemId);
  if (validation === undefined) {
    return { reason: 'no preparation report' };
  }
  if (!validation.report.machinePassed) {
    const codes = validation.report.findings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => finding.code)
      .join(', ');
    return { reason: `machine gate rejected (${codes})` };
  }
  const job = jobsById.get(record.itemId);
  return job === undefined
    ? { reason: 'not declared by the brief' }
    : { item: { record, validation, job } };
};

const stagedHashOf = (record: JobRecord): string | undefined => {
  const staged = record.stagedPath;
  return staged !== undefined && existsSync(staged) ? sha256File(staged) : undefined;
};

const existingHashOf = (destination: string): string | undefined =>
  existsSync(destination) ? sha256File(destination) : undefined;

/** The staged bytes must still be the candidate the preparation gate approved. */
const preparedMismatch = (record: JobRecord, stagedHash: string): string | undefined => {
  if (record.preparedHash === undefined || record.preparedHash === stagedHash) {
    return undefined;
  }
  return `staged bytes are not the prepared candidate (staged ${stagedHash.slice(0, 12)} vs recorded ${record.preparedHash.slice(0, 12)})`;
};

const destinationConflict = (options: {
  destination: string;
  stagedHash: string;
  existingHash: string | undefined;
  force: boolean;
}): string | undefined => {
  const { destination, stagedHash, existingHash, force } = options;
  if (force || existingHash === undefined || existingHash === stagedHash) {
    return undefined;
  }
  return `destination already holds different bytes (${destination}) — pass --force to replace`;
};

/** Every guard between a job record and a cleared install, in refusal order. */
const planItem = (options: {
  record: JobRecord;
  passedByItem: Map<string, Validation>;
  jobsById: Map<string, BriefJob>;
  manifestProps: ManifestProps;
  force: boolean;
}): Planned => {
  const { record, manifestProps, force } = options;
  const eligible = eligibleItem(options);
  if ('reason' in eligible) {
    return eligible;
  }
  const { job } = eligible.item;
  if (neutralPortraitMissing(job)) {
    return { reason: 'required neutral portrait is not installed' };
  }
  const destination = destinationFor(job, manifestProps);
  if (destination === undefined) {
    return { reason: 'no authoring path bound for this binding' };
  }
  const staged = record.stagedPath;
  const stagedHash = stagedHashOf(record);
  if (staged === undefined || stagedHash === undefined) {
    return { reason: 'staged bytes are missing' };
  }
  const mismatch = preparedMismatch(record, stagedHash);
  if (mismatch !== undefined) {
    return { reason: mismatch };
  }
  const existingHash = existingHashOf(destination);
  const conflict = destinationConflict({ destination, stagedHash, existingHash, force });
  if (conflict !== undefined) {
    return { reason: conflict };
  }
  return {
    plan: {
      record,
      staged,
      destination,
      stagedHash,
      replaced: existingHash !== undefined && existingHash !== stagedHash,
    },
  };
};

const applyPlan = (plan: InstallPlan): void => {
  mkdirSync(dirname(plan.destination), { recursive: true });
  copyFileSync(plan.staged, plan.destination);
};

const installedEntry = (plan: InstallPlan): Record<string, unknown> => ({
  itemId: plan.record.itemId,
  candidateId: plan.record.candidateId,
  preparedHash: plan.stagedHash,
  installedAt: plan.destination.slice(repository.length + 1),
  replaced: plan.replaced,
});

/**
 * Walks every job record, appending to the caller's arrays so a mid-run failure
 * still leaves a truthful partial acceptance record.
 */
const installAll = (options: {
  jobRecords: JobRecord[];
  passedByItem: Map<string, Validation>;
  jobsById: Map<string, BriefJob>;
  manifestProps: ManifestProps;
  apply: boolean;
  force: boolean;
  installed: Record<string, unknown>[];
  skipped: Record<string, unknown>[];
}): void => {
  for (const record of options.jobRecords) {
    const planned = planItem({
      record,
      passedByItem: options.passedByItem,
      jobsById: options.jobsById,
      manifestProps: options.manifestProps,
      force: options.force,
    });
    if ('reason' in planned) {
      options.skipped.push({ itemId: record.itemId, reason: planned.reason });
      continue;
    }
    if (options.apply) {
      applyPlan(planned.plan);
    }
    options.installed.push(installedEntry(planned.plan));
  }
};

type RunContext = {
  brief: Brief;
  jobsById: Map<string, BriefJob>;
  manifestProps: ManifestProps;
  passedByItem: Map<string, Validation>;
  jobRecords: JobRecord[];
};

const readJobRecords = (jobsDir: string): JobRecord[] =>
  existsSync(jobsDir)
    ? readdirSync(jobsDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(join(jobsDir, name), 'utf8')) as JobRecord)
    : [];

const loadRunContext = (runDir: string): RunContext => {
  const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as Brief;
  const manifest = JSON.parse(readFileSync(join(packRoot, 'manifest.json'), 'utf8')) as {
    props?: ManifestProps;
  };
  const validationPath = join(runDir, 'media-validation.json');
  const validations = existsSync(validationPath)
    ? (JSON.parse(readFileSync(validationPath, 'utf8')) as MediaValidation).validations
    : [];
  return {
    brief,
    jobsById: new Map(brief.jobs.map((job) => [job.id, job])),
    manifestProps: manifest.props ?? {},
    passedByItem: new Map(validations.map((validation) => [validation.itemId, validation])),
    jobRecords: readJobRecords(join(runDir, 'jobs')),
  };
};

/**
 * Persists the acceptance record. A write failure is only fatal when nothing
 * else went wrong: when an install already failed, the original error is the
 * one the operator needs, and this reports the lost record alongside it.
 */
const persistRecord = (options: {
  recordPath: string;
  runId: string;
  briefId: string;
  installed: Record<string, unknown>[];
  skipped: Record<string, unknown>[];
  installFailed: boolean;
}): void => {
  try {
    writeFileSync(
      options.recordPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'emberwatch-acceptance',
          runId: options.runId,
          briefId: options.briefId,
          acceptedAt: new Date().toISOString(),
          installed: options.installed,
          skipped: options.skipped,
        },
        null,
        2,
      )}\n`,
    );
  } catch (recordError) {
    if (!options.installFailed) {
      throw recordError;
    }
    console.error(`Failed to persist partial acceptance record: ${String(recordError)}`);
  }
};

const printOutcome = (options: {
  runId: string;
  apply: boolean;
  recordPath: string;
  installed: Record<string, unknown>[];
  skipped: Record<string, unknown>[];
}): void => {
  console.log(`Emberwatch acceptance — run ${options.runId}${options.apply ? '' : ' (dry run)'}`);
  console.log(`  installable: ${options.installed.length}  skipped: ${options.skipped.length}`);
  for (const entry of options.installed) {
    console.log(
      `  ✅ ${entry.itemId} → ${entry.installedAt} (${String(entry.preparedHash).slice(0, 12)})`,
    );
  }
  for (const entry of options.skipped) {
    console.log(`  ⏭️  ${entry.itemId} — ${entry.reason}`);
  }
  if (options.apply) {
    console.log(`  record: ${options.recordPath}`);
  }
};

const flagValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const runId = flagValue(args, '--run');
  if (runId === undefined) {
    console.error('Usage: emberwatch_accept.ts --run <runId> [--apply] [--force]');
    process.exit(4);
  }
  const apply = args.includes('--apply');
  const force = args.includes('--force');

  const runDir = join(runsRoot, runId);
  if (!existsSync(runDir)) {
    console.error(`No run directory at ${runDir}`);
    process.exit(4);
  }

  const context = loadRunContext(runDir);
  const installed: Record<string, unknown>[] = [];
  const skipped: Record<string, unknown>[] = [];
  let installFailed = false;
  let installFailure: unknown;
  try {
    installAll({
      jobRecords: context.jobRecords,
      passedByItem: context.passedByItem,
      jobsById: context.jobsById,
      manifestProps: context.manifestProps,
      apply,
      force,
      installed,
      skipped,
    });
  } catch (error) {
    installFailed = true;
    installFailure = error;
  }

  const recordPath = join(runDir, 'acceptance.json');
  if (apply) {
    persistRecord({
      recordPath,
      runId,
      briefId: context.brief.id,
      installed,
      skipped,
      installFailed,
    });
  }
  if (installFailed) {
    throw installFailure;
  }

  printOutcome({ runId, apply, recordPath, installed, skipped });
};

main();
