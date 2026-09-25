// scripts/src/lib/ops/emberwatch_release_cli.ts
//
// The invocation half of the Emberwatch release orchestrator: parsing the
// command line, reading the pack identity, and the pre-flight refusals that
// happen before any phase runs.
//
// Extracted from `emberwatch_release.ts` so that file can stay what its name
// says — a shell over typed phases — instead of a mix of argument parsing,
// console formatting and orchestration. Nothing here decides anything about a
// release; it decides whether the invocation is well-formed and whether the
// checkout is in a state a release may start from.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read-only plan fixture directory used by CLI-path tests.
 *
 * The release shell honors this only for `--plan` and only when the existing
 * release-plane isolation seam is also present. Apply always resolves the live
 * release graph, so this cannot redirect a publication.
 */
export const RELEASE_PLAN_SNAPSHOT_ENV = 'AIKAMI_RELEASE_PLAN_SNAPSHOT';

export const USAGE = `Emberwatch release orchestrator

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

export type Invocation = {
  mode: 'staging' | 'production';
  apply: boolean;
  skipTests: boolean;
  allowDirty: boolean;
  buildCandidate: boolean;
  acceptRun?: string;
};

export type PackIdentity = { manifestVersion: string; indexVersion: string | undefined };

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

export const parseInvocation = (args: string[]): Invocation => {
  const buildCandidate = args.includes('--build-candidate');
  const acceptRun = flagValue(args, '--accept-run');
  const mode = flagValue(args, '--mode');
  if (mode !== 'staging' && mode !== 'production') {
    // A candidate build is LOCAL and mode-independent: it performs no remote
    // write, so requiring a target mode would be a fiction. `staging` is used
    // only for the "review it, then run …" hint it prints.
    if (buildCandidate) {
      return {
        mode: 'staging',
        apply: false,
        skipTests: false,
        allowDirty: false,
        buildCandidate: true,
        ...(acceptRun === undefined ? {} : { acceptRun }),
      };
    }
    console.error('❌ --mode must be staging or production.');
    console.error(USAGE);
    process.exit(4);
  }
  return {
    mode,
    apply: args.includes('--apply'),
    skipTests: args.includes('--skip-tests'),
    allowDirty: args.includes('--allow-dirty'),
    buildCandidate,
    ...(acceptRun === undefined ? {} : { acceptRun }),
  };
};

export const readPackIdentity = (repository: string): PackIdentity => {
  const manifest = JSON.parse(
    readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
  ) as { version: string };
  const index = JSON.parse(readFileSync(join(repository, 'content/packs/index.json'), 'utf8')) as {
    packs: { id: string; version: string }[];
  };
  return {
    manifestVersion: manifest.version,
    indexVersion: index.packs.find((pack) => pack.id === 'emberwatch')?.version,
  };
};

export const printHeader = (options: {
  mode: string;
  apply: boolean;
  sourceCommit: string;
  pack: PackIdentity;
  dirty: boolean;
}): void => {
  console.log(`Emberwatch release — mode ${options.mode} — ${options.apply ? 'APPLY' : 'PLAN'}`);
  console.log(`  source commit: ${options.sourceCommit}`);
  console.log(
    `  pack version:  ${options.pack.manifestVersion} (index: ${options.pack.indexVersion ?? 'absent'})`,
  );
  console.log(`  worktree:      ${options.dirty ? 'dirty' : 'clean'}`);
  console.log('');
};

/** Refuses a publish whose manifest and index disagree about the pack version. */
export const assertVersionParity = (pack: PackIdentity): void => {
  if (pack.manifestVersion === pack.indexVersion) {
    return;
  }
  console.error('❌ manifest/index version drift — refusing. Fix before releasing.');
  process.exit(2);
};

export const assertCleanForApply = (options: {
  dirty: boolean;
  apply: boolean;
  allowDirty: boolean;
}): void => {
  if (!options.dirty || !options.apply || options.allowDirty) {
    return;
  }
  console.error('❌ worktree is dirty — refusing --apply. Commit, or pass --allow-dirty.');
  process.exit(2);
};
