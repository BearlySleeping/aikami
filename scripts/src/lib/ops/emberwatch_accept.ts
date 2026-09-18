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
// Run:
//   bun scripts/src/lib/ops/emberwatch_accept.ts --run <runId> [--apply] [--force]
//
// Default is a dry run that prints exactly what would be installed.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

type MediaValidation = {
  validations: {
    itemId: string;
    rawSha256: string;
    preparedSha256: string;
    report: { machinePassed: boolean; findings: { code: string; severity: string }[] };
  }[];
};

type JobRecord = {
  itemId: string;
  status: string;
  candidateId?: string;
  preparedHash?: string;
  stagedPath?: string;
};

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
const propFrameFor = (targetId: string): string | undefined => {
  const manifest = JSON.parse(readFileSync(join(packRoot, 'manifest.json'), 'utf8')) as {
    props?: Record<string, { frame?: string }>;
  };
  return manifest.props?.[targetId]?.frame;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const runFlag = args.indexOf('--run');
  const runId = runFlag >= 0 ? args[runFlag + 1] : undefined;
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

  const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as Brief;
  const jobsById = new Map(brief.jobs.map((job) => [job.id, job]));

  const validationPath = join(runDir, 'media-validation.json');
  const validations = existsSync(validationPath)
    ? (JSON.parse(readFileSync(validationPath, 'utf8')) as MediaValidation).validations
    : [];
  const passedByItem = new Map(validations.map((v) => [v.itemId, v]));

  const jobRecords: JobRecord[] = [];
  const jobsDir = join(runDir, 'jobs');
  if (existsSync(jobsDir)) {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    for (const name of readdirSync(jobsDir)) {
      if (!name.endsWith('.json')) {
        continue;
      }
      jobRecords.push(JSON.parse(readFileSync(join(jobsDir, name), 'utf8')) as JobRecord);
    }
  }

  const installed: Record<string, unknown>[] = [];
  const skipped: Record<string, unknown>[] = [];

  for (const record of jobRecords) {
    if (record.status !== 'awaiting_review') {
      skipped.push({ itemId: record.itemId, reason: `job status ${record.status}` });
      continue;
    }
    const validation = passedByItem.get(record.itemId);
    if (validation === undefined) {
      skipped.push({ itemId: record.itemId, reason: 'no preparation report' });
      continue;
    }
    if (!validation.report.machinePassed) {
      const codes = validation.report.findings
        .filter((f) => f.severity === 'error')
        .map((f) => f.code)
        .join(', ');
      skipped.push({ itemId: record.itemId, reason: `machine gate rejected (${codes})` });
      continue;
    }

    const job = jobsById.get(record.itemId);
    if (job === undefined) {
      skipped.push({ itemId: record.itemId, reason: 'not declared by the brief' });
      continue;
    }

    let destination = targetPathFor(job);
    if (destination === undefined && job.kind === 'prop') {
      const frame = propFrameFor(job.binding.targetIds[0] ?? '');
      if (frame !== undefined) {
        destination = join(packRoot, 'props', frame);
      }
    }
    if (destination === undefined) {
      skipped.push({ itemId: record.itemId, reason: 'no authoring path bound for this binding' });
      continue;
    }

    const staged = record.stagedPath;
    if (staged === undefined || !existsSync(staged)) {
      skipped.push({ itemId: record.itemId, reason: 'staged bytes are missing' });
      continue;
    }

    const stagedHash = sha256File(staged);
    if (record.preparedHash !== undefined && stagedHash !== record.preparedHash) {
      skipped.push({
        itemId: record.itemId,
        reason: `staged bytes are not the prepared candidate (staged ${stagedHash.slice(0, 12)} vs recorded ${record.preparedHash.slice(0, 12)})`,
      });
      continue;
    }

    const existingHash = existsSync(destination) ? sha256File(destination) : undefined;
    if (existingHash !== undefined && existingHash !== stagedHash && !force) {
      skipped.push({
        itemId: record.itemId,
        reason: `destination already holds different bytes (${destination}) — pass --force to replace`,
      });
      continue;
    }

    if (apply) {
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(staged, destination);
    }
    installed.push({
      itemId: record.itemId,
      candidateId: record.candidateId,
      preparedHash: stagedHash,
      installedAt: destination.slice(repository.length + 1),
      replaced: existingHash !== undefined && existingHash !== stagedHash,
    });
  }

  const recordPath = join(runDir, 'acceptance.json');
  if (apply) {
    writeFileSync(
      recordPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'emberwatch-acceptance',
          runId,
          briefId: brief.id,
          acceptedAt: new Date().toISOString(),
          installed,
          skipped,
        },
        null,
        2,
      )}\n`,
    );
  }

  console.log(`Emberwatch acceptance — run ${runId}${apply ? '' : ' (dry run)'}`);
  console.log(`  installable: ${installed.length}  skipped: ${skipped.length}`);
  for (const entry of installed) {
    console.log(
      `  ✅ ${entry.itemId} → ${entry.installedAt} (${String(entry.preparedHash).slice(0, 12)})`,
    );
  }
  for (const entry of skipped) {
    console.log(`  ⏭️  ${entry.itemId} — ${entry.reason}`);
  }
  if (apply) {
    console.log(`  record: ${recordPath}`);
  }
};

main();
