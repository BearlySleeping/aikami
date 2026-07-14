#!/usr/bin/env bun
// scripts/src/lib/agents/contract_pipeline.ts
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { runContractPipeline } from './contract_pipeline/orchestrator.ts';

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

type CliArguments = {
  target?: string;
  resumeRunId?: string;
  background: boolean;
  dryRun: boolean;
  fresh: boolean;
  noAttach: boolean;
  launcherToken?: string;
  help: boolean;
};

const parseArguments = (): CliArguments => {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const consumed = new Set<string>();
  for (const flag of ['--resume', '--launcher-token']) {
    const value = valueAfter(flag);
    if (value) {
      consumed.add(value);
    }
  }
  return {
    target: args.find((value) => !value.startsWith('--') && !consumed.has(value)),
    resumeRunId: valueAfter('--resume'),
    launcherToken: valueAfter('--launcher-token'),
    background: args.includes('--background'),
    dryRun: args.includes('--dry-run'),
    fresh: args.includes('--fresh'),
    noAttach: args.includes('--no-attach'),
    help: args.length === 0 || args.includes('--help') || args.includes('-h'),
  };
};

const printHelp = (): void => {
  console.log(`
Usage:
  bun run contract C-365
  bun run contract docs/contracts/C-365-....md
  bun run contract --resume <run-id>
  bun run contract C-365 --dry-run

Options:
  --resume <run-id>  Resume an incomplete v3 run
  --dry-run          Resolve and create the manifest without starting Herdr/Pi
  --background       Internal/background mode; do not attach Herdr
  --fresh            Start a brand-new run (skip auto-resume)
  --no-attach        Run pipeline in background without attaching to herdr
  -h, --help         Show this help
`);
};

const atomicWrite = (options: { path: string; value: unknown }): void => {
  const temporaryPath = `${options.path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(options.value, undefined, 2));
  renameSync(temporaryPath, options.path);
};

const launchBackground = async (options: { noAttach: boolean }): Promise<void> => {
  const token = `launch-${Date.now().toString(36)}-${process.pid}`;
  const runsDirectory = join(process.cwd(), '.pi/contract-runs');
  mkdirSync(runsDirectory, { recursive: true });
  const readyPath = join(runsDirectory, `${token}.json`);
  const launcherLogPath = join(runsDirectory, `${token}.log`);
  const descriptor = openSync(launcherLogPath, 'a');
  const forwarded = process.argv
    .slice(2)
    .filter((value) => value !== '--background' && value !== '--no-attach');
  const child = spawn(
    'bun',
    ['run', import.meta.path, ...forwarded, '--background', '--launcher-token', token],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', descriptor, descriptor],
      env: process.env,
    },
  );
  child.unref();
  closeSync(descriptor);

  const deadline = Date.now() + 30_000;
  while (!existsSync(readyPath) && Date.now() < deadline) {
    await sleep(250);
  }
  if (!existsSync(readyPath)) {
    const diagnostic = existsSync(launcherLogPath)
      ? readFileSync(launcherLogPath, 'utf-8').slice(-4_000)
      : 'No launcher log was produced.';
    throw new Error(`Pipeline did not become ready.\n${diagnostic}`);
  }

  const ready = JSON.parse(readFileSync(readyPath, 'utf-8')) as {
    runId?: string;
    workspaceId?: string;
  };
  console.log(`Pipeline ${ready.runId ?? token} ready in ${ready.workspaceId ?? 'Herdr'}.`);
  if (options.noAttach) {
    console.log(
      'Running detached — pipeline continues in background. Use herdr session attach default to view.',
    );
    return;
  }
  if (ready.workspaceId) {
    const focus = spawn('herdr', ['workspace', 'focus', ready.workspaceId], {
      stdio: 'ignore',
    });
    await new Promise<void>((resolve) => focus.once('close', () => resolve()));
  }
  console.log('Attaching to Herdr. Detaching the UI does not stop the background pipeline.');
  const attach = spawn('herdr', ['session', 'attach', 'default'], { stdio: 'inherit' });
  await new Promise<void>((resolve) => attach.once('close', () => resolve()));
};

const main = async (): Promise<void> => {
  const cli = parseArguments();
  if (cli.help && !cli.resumeRunId) {
    printHelp();
    return;
  }

  if (!cli.background && !cli.dryRun) {
    await launchBackground({ noAttach: cli.noAttach });
    return;
  }

  const manifest = await runContractPipeline({
    repoRoot: process.cwd(),
    target: cli.target,
    resumeRunId: cli.resumeRunId,
    fresh: cli.fresh,
    dryRun: cli.dryRun,
    onReady: cli.launcherToken
      ? (readyManifest) => {
          atomicWrite({
            path: join(process.cwd(), '.pi/contract-runs', `${cli.launcherToken}.json`),
            value: {
              runId: readyManifest.runId,
              workspaceId: readyManifest.workspaceId,
            },
          });
        }
      : undefined,
  });

  if (cli.dryRun) {
    console.log(
      JSON.stringify(
        {
          runId: manifest.runId,
          contractId: manifest.contractId,
          contractPath: manifest.contractPath,
          startStage: manifest.currentStage,
        },
        undefined,
        2,
      ),
    );
  }
};

await main();
