// scripts/src/lib/ops/emberwatch_release.ts
//
// The single operator front door for an Emberwatch release.
//
//   bun run emberwatch:release --mode staging --plan
//   bun run emberwatch:release --mode staging --apply
//   bun run emberwatch:release --mode production --plan
//   bun run emberwatch:release --mode production --apply
//
// It ORCHESTRATES the components the repository already ships — it does not
// reimplement any of them:
//
//   brief rebase check      scripts/src/lib/ops/rebase_emberwatch_brief.ts
//   prop table check        scripts/src/lib/ops/sync_emberwatch_props.ts
//   candidate acceptance    scripts/src/lib/ops/emberwatch_accept.ts
//   terrain/grid atlas      scripts/src/lib/ops/generate_emberwatch_atlas.ts
//   prop atlas pages        scripts/src/lib/ops/generate_emberwatch_props_atlas.ts
//   canonical maps          scripts/src/lib/ops/generate_emberwatch_maps.ts
//   coverage audit          scripts/src/lib/ops/emberwatch_coverage_audit.ts
//   scan manifest + hashes  scripts/src/lib/ops/scan_assets.ts
//   catalog publish         scripts/src/lib/catalog/publish.ts
//   post-publish verify     this file, through the public origin
//
// Guarantees:
//   • `--plan` performs NO remote write and no local artifact mutation. It runs
//     only the read-only checks and reports what `--apply` would do.
//   • `--apply` refuses a dirty worktree unless `--allow-dirty`, refuses a
//     stale brief/prop table, refuses a coverage audit with blockers, and stops
//     before publishing if any upstream step fails.
//   • the previous release pointer is read and recorded before any write, so
//     rollback has a named target.
//   • credentials are never printed. Only the bucket name and origin are.
//   • nothing is ever deleted: the publisher writes immutable content-addressed
//     objects and advances the pointer last.
//   • a machine-readable release report is written under
//     `.local/releases/<mode>/<timestamp>.json`.
//
// Exit codes: 0 ok · 1 a step failed · 2 refused (dirty/stale/blocked) · 4 usage.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');

const USAGE = `Emberwatch release orchestrator

  bun run emberwatch:release --mode staging|production [--plan|--apply] [options]

Options:
  --mode <staging|production>   Required. The release target.
  --build-candidate             Run the deterministic content build (install
                              portraits/audio, regenerate atlas + maps, rescan)
                              and SEAL a candidate. Mutates local artifacts and
                              performs no remote write. Run this BEFORE --plan.
--plan                        Read-only: checks + the intended step list. Default.
  --apply                       Execute every step, including the remote publish.
  --accept-run <runId>          Install the machine-passing candidates of a
                                generate:batch run before rebuilding artifacts.
  --skip-tests                  Skip the validation step (not recommended).
  --allow-dirty                 Allow a dirty worktree (recorded in the report).
  --help                        Print this message.
`;

type StepResult = {
  name: string;
  command: string;
  status: 'ok' | 'failed' | 'skipped';
  exitCode: number;
  durationMs: number;
  detail?: string;
};

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log(USAGE);
  process.exit(args.length === 0 ? 4 : 0);
}

const flagValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const mode = flagValue('--mode');
if (mode !== 'staging' && mode !== 'production') {
  console.error('❌ --mode must be staging or production.');
  console.error(USAGE);
  process.exit(4);
}
const apply = args.includes('--apply');
const skipTests = args.includes('--skip-tests');
const allowDirty = args.includes('--allow-dirty');
const acceptRun = flagValue('--accept-run');
const buildCandidate = args.includes('--build-candidate');

const steps: StepResult[] = [];
const record = (entry: StepResult): void => {
  steps.push(entry);
  let icon = '✅';
  if (entry.status === 'skipped') {
    icon = '⏭️';
  } else if (entry.status === 'failed') {
    icon = '❌';
  }
  console.log(
    `${icon} ${entry.name} (${entry.durationMs}ms)${entry.detail ? ` — ${entry.detail}` : ''}`,
  );
};

/** Runs a command from the repository root, capturing output for the report. */
const run = (
  name: string,
  command: string,
  commandArgs: string[],
  options: { cwd?: string; required?: boolean } = {},
): StepResult => {
  const started = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repository,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const exitCode = result.status ?? 1;
  const entry: StepResult = {
    name,
    command: [command, ...commandArgs].join(' '),
    status: exitCode === 0 ? 'ok' : 'failed',
    exitCode,
    durationMs: Date.now() - started,
    ...(exitCode === 0
      ? {}
      : {
          detail: `${(result.stderr ?? result.stdout ?? '').trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`,
        }),
  };
  record(entry);
  return entry;
};

const bun = (name: string, script: string, scriptArgs: string[] = []): StepResult =>
  run(name, 'bun', [script, ...scriptArgs]);

const git = (gitArgs: string[]): string =>
  execFileSync('git', gitArgs, { cwd: repository, encoding: 'utf8' }).trim();

/** Reads the currently published release pointer over the public origin. */
const readReleasePointer = async (
  originUrl: string,
): Promise<{ key: string; sha256?: string; body?: unknown; status: number }> => {
  const key = 'index/v1/release.json';
  try {
    const response = await fetch(`${originUrl.replace(/\/$/, '')}/${key}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { key, status: response.status };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    return {
      key,
      sha256: digest,
      body: JSON.parse(new TextDecoder().decode(bytes)),
      status: response.status,
    };
  } catch (error) {
    return { key, status: 0, body: { error: (error as Error).message } };
  }
};

const main = async (): Promise<void> => {
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']).length > 0;

  const packManifest = JSON.parse(
    readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
  ) as { version: string };
  const packIndex = JSON.parse(
    readFileSync(join(repository, 'content/packs/index.json'), 'utf8'),
  ) as {
    packs: { id: string; version: string }[];
  };
  const indexEntry = packIndex.packs.find((pack) => pack.id === 'emberwatch');

  console.log(`Emberwatch release — mode ${mode} — ${apply ? 'APPLY' : 'PLAN'}`);
  console.log(`  source commit: ${sourceCommit}`);
  console.log(
    `  pack version:  ${packManifest.version} (index: ${indexEntry?.version ?? 'absent'})`,
  );
  console.log(`  worktree:      ${dirty ? 'dirty' : 'clean'}`);
  console.log('');

  if (packManifest.version !== indexEntry?.version) {
    console.error('❌ manifest/index version drift — refusing. Fix before releasing.');
    process.exit(2);
  }
  if (dirty && apply && !allowDirty) {
    console.error('❌ worktree is dirty — refusing --apply. Commit, or pass --allow-dirty.');
    process.exit(2);
  }

  // ── Release-target preflight: BEFORE any write ──────────────────────────
  //
  // `resolveCatalogConfig` runs the fail-closed release-target gate
  // (`catalog/release_target.ts`): a remote mode accepts only the bucket and
  // origin it declares, so a `CATALOG_BUCKET` override — as
  // `scripts/.env.staging` used to carry, pointing at the PRODUCTION bucket —
  // cannot retarget the run. The gate throws before this process can write.
  const { resolveCatalogConfig } = await import('../catalog/config.ts');
  let config: Awaited<ReturnType<typeof resolveCatalogConfig>>;
  try {
    config = resolveCatalogConfig(mode);
  } catch (error) {
    console.error('');
    console.error(`❌ release target refused — nothing was written.`);
    console.error(`   ${(error as Error).message}`);
    console.error('');
    console.error(
      '   A staging release needs its OWN bucket and read origin. Verifying a staging\n' +
        '   write by reading the production origin proves nothing about staging.',
    );
    process.exit(2);
  }

  // Safe target identity only — never a credential.
  const releaseTarget = config.releaseTarget;
  if (releaseTarget === undefined) {
    throw new Error('resolveCatalogConfig returned no validated release target');
  }
  const targetMatchesConfig =
    config.bucket === releaseTarget.bucket && config.originUrl === releaseTarget.originUrl;
  console.log(
    `  bucket:        ${config.bucket}${releaseTarget.viaTestSeam ? ' (test seam)' : ''}`,
  );
  console.log(`  origin:        ${config.originUrl}`);
  for (const warning of releaseTarget.warnings) {
    console.warn(`  warning:       ${warning}`);
  }
  if (releaseTarget.viaTestSeam || !targetMatchesConfig) {
    console.warn(`  target check:  rehearsal or mismatched target — not reported as ok`);
  } else {
    console.log(`  target check:  ok (bucket and origin match mode ${mode})`);
  }
  console.log('');
  const previous = await readReleasePointer(config.originUrl);
  console.log(
    `  previous release pointer: ${previous.status === 200 ? `${previous.sha256?.slice(0, 12)} (${previous.key})` : `absent (HTTP ${previous.status})`}`,
  );
  console.log('');

  // ── Read-only checks (both modes) ────────────────────────────────────────
  const briefCheck = bun('brief rebase check', 'scripts/src/lib/ops/rebase_emberwatch_brief.ts', [
    '--check',
  ]);
  if (briefCheck.status === 'failed') {
    console.error(
      '❌ brief is not rebased — run: bun scripts/src/lib/ops/rebase_emberwatch_brief.ts',
    );
    process.exit(2);
  }
  const propsCheck = bun('prop table check', 'scripts/src/lib/ops/sync_emberwatch_props.ts', [
    '--check',
  ]);
  if (propsCheck.status === 'failed') {
    console.error(
      '❌ prop table out of sync — run: bun scripts/src/lib/ops/sync_emberwatch_props.ts',
    );
    process.exit(2);
  }

  // ── Candidate acceptance (only when an operator names a run) ─────────────
  if (acceptRun !== undefined) {
    const acceptArgs = ['--run', acceptRun];
    if (apply) {
      acceptArgs.push('--apply');
    }
    const accepted = bun(
      'accept candidates',
      'scripts/src/lib/ops/emberwatch_accept.ts',
      acceptArgs,
    );
    if (accepted.status === 'failed') {
      process.exit(1);
    }
  } else {
    record({
      name: 'accept candidates',
      command: "(none — pass --accept-run <runId> to install a run's accepted candidates)",
      status: 'skipped',
      exitCode: 0,
      durationMs: 0,
    });
  }

  if (!apply) {
    // Plan mode: report the intended steps without touching anything.
    for (const name of [
      'install portraits (pack → game-data + manifest binding)',
      'install authored audio beds (pack → game-data music category)',
      'generate terrain/grid atlas',
      'generate prop atlas pages',
      'regenerate canonical maps',
      'coverage audit',
      'scan manifest + hashes + credits',
      'validate (tests + typecheck + lint + guards)',
      `publish catalog (${mode})`,
      'verify published release',
    ]) {
      record({
        name,
        command: '(planned — run with --apply)',
        status: 'skipped',
        exitCode: 0,
        durationMs: 0,
      });
    }
    const audit = bun(
      'coverage audit (read-only)',
      'scripts/src/lib/ops/emberwatch_coverage_audit.ts',
    );
    const report = buildReport(sourceCommit, packManifest.version, config, previous, undefined);
    writeReport(mode, report);
    console.log('');
    console.log(
      `Plan complete. Coverage audit exit ${audit.exitCode}. No remote write was performed.`,
    );
    process.exit(audit.exitCode === 0 ? 0 : 2);
  }

  // ── Candidate construction — ONLY under --build-candidate ───────────────
  //
  // These steps are deterministic content BUILDING: they install authored
  // portraits and audio into the runtime game-data plane, regenerate the
  // terrain atlas, prop-atlas pages and canonical maps, and rescan the manifest.
  //
  // They must NOT run during --apply. A release promotes a candidate that was
  // sealed once; rebuilding during publication is exactly how staging and
  // production end up publishing different bytes while both report success.
  // Building lives here, sealing lives in `emberwatch_candidate.ts`, and
  // publishing consumes the seal.
  if (buildCandidate) {
    const buildSteps: [string, string][] = [
      ['install portraits', 'scripts/src/lib/ops/install_emberwatch_portraits.ts'],
      ['install authored audio beds', 'scripts/src/lib/ops/install_emberwatch_audio.ts'],
      ['generate terrain/grid atlas', 'scripts/src/lib/ops/generate_emberwatch_atlas.ts'],
      ['generate prop atlas pages', 'scripts/src/lib/ops/generate_emberwatch_props_atlas.ts'],
      ['regenerate canonical maps', 'scripts/src/lib/ops/generate_emberwatch_maps.ts'],
      ['scan manifest + hashes + credits', 'scripts/src/lib/ops/scan_assets.ts'],
    ];
    for (const [label, script] of buildSteps) {
      if (bun(label, script).status === 'failed') {
        process.exit(1);
      }
    }
    const audit = bun('coverage audit', 'scripts/src/lib/ops/emberwatch_coverage_audit.ts');
    if (audit.status === 'failed') {
      console.error('❌ coverage audit reports blockers — refusing to seal.');
      process.exit(2);
    }
    const seal = bun('seal candidate', 'scripts/src/lib/ops/emberwatch_candidate.ts', ['--seal']);
    if (seal.status === 'failed') {
      console.error('❌ candidate sealing failed.');
      process.exit(1);
    }
    console.log('');
    console.log('Candidate built and sealed. Review it, then:');
    console.log(`  bun run emberwatch:release --mode ${mode} --plan`);
    process.exit(0);
  }

  // ── Candidate verification — REQUIRED before any publish ────────────────
  //
  // A publish consumes the sealed candidate. If the working tree no longer
  // produces it, publishing would ship bytes nobody reviewed, so this refuses.
  const candidateVerify = bun(
    'verify sealed candidate',
    'scripts/src/lib/ops/emberwatch_candidate.ts',
    ['--verify'],
  );
  if (candidateVerify.status === 'failed') {
    console.error(
      '❌ the sealed candidate does not match the working tree — refusing to publish.\n' +
        '   Build and seal a fresh candidate first:\n' +
        '     bun run emberwatch:build-candidate',
    );
    process.exit(2);
  }

  if (!skipTests) {
    const validate = run('validate (moon affected)', 'bun', ['moon', 'ci', '--base=origin/main']);
    if (validate.status === 'failed') {
      console.error('❌ validation failed — refusing to publish.');
      process.exit(1);
    }
  } else {
    record({
      name: 'validate (moon affected)',
      command: '(skipped)',
      status: 'skipped',
      exitCode: 0,
      durationMs: 0,
    });
  }

  // ── Publish ──────────────────────────────────────────────────────────────
  const publish = run(`publish catalog (${mode})`, 'bun', [
    'run',
    'scripts/src/lib/catalog/publish.ts',
    '--mode',
    mode,
  ]);
  if (publish.status === 'failed') {
    console.error('❌ publish failed. The previous release pointer is untouched.');
    writeReport(mode, buildReport(sourceCommit, packManifest.version, config, previous, undefined));
    process.exit(1);
  }

  // ── Verify ───────────────────────────────────────────────────────────────
  const after = await readReleasePointer(config.originUrl);
  const advanced = after.status === 200 && after.sha256 !== previous.sha256;
  record({
    name: 'verify published release',
    command: `GET ${config.originUrl}/index/v1/release.json`,
    status: advanced ? 'ok' : 'failed',
    exitCode: advanced ? 0 : 1,
    durationMs: 0,
    detail: advanced
      ? `pointer ${previous.sha256?.slice(0, 12) ?? 'absent'} → ${after.sha256?.slice(0, 12)}`
      : 'the release pointer did not advance',
  });

  const report = buildReport(sourceCommit, packManifest.version, config, previous, after);
  writeReport(mode, report);

  console.log('');
  console.log(`Release report: ${reportPath(mode)}`);
  console.log(
    `Rollback: re-point index/v1/release.json at ${
      previous.status === 200 ? previous.sha256 : '(no previous release)'
    }`,
  );
  process.exit(advanced ? 0 : 1);
};

type ReportInput = {
  sourceCommit: string;
  packVersion: string;
  config: { bucket: string; originUrl: string };
  previous: { key: string; sha256?: string; status: number; body?: unknown };
  after?: { key: string; sha256?: string; status: number; body?: unknown };
};

const buildReport = (
  sourceCommit: string,
  packVersion: string,
  config: { bucket: string; originUrl: string },
  previous: ReportInput['previous'],
  after: ReportInput['after'],
): Record<string, unknown> => ({
  schemaVersion: 1,
  kind: 'emberwatch-release-report',
  sourceCommit,
  packVersion,
  bucket: config.bucket,
  originUrl: config.originUrl,
  mode,
  applied: apply,
  dirtyWorktree: git(['status', '--porcelain']).length > 0,
  dirtyWorktreeAllowed: allowDirty,
  generatedAt: new Date().toISOString(),
  previousRelease: { key: previous.key, sha256: previous.sha256 ?? null, status: previous.status },
  newRelease:
    after === undefined
      ? null
      : { key: after.key, sha256: after.sha256 ?? null, status: after.status },
  steps,
});

const reportPath = (targetMode: string): string =>
  join(
    repository,
    '.local/releases',
    targetMode,
    `${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );

const writeReport = (targetMode: string, report: Record<string, unknown>): void => {
  const path = reportPath(targetMode);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
};

if (!existsSync(join(repository, 'content/packs/emberwatch/manifest.json'))) {
  console.error('❌ not run from the Aikami repository root.');
  process.exit(4);
}

await main();
