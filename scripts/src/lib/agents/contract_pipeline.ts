#!/usr/bin/env bun
// scripts/src/lib/agents/contract_pipeline.ts
//
// Contract Pipeline CLI — entry point for `bun run contract`.
// Supports three --source modes:
//   --source todo     (default) Parse docs/TODO.md and generate contract from backlog item
//   --source roadmap  Fetch from GitHub Issue or Project v2 item and freeze into contract
//   --source direct   Initiate interactive Pi session for conversational contract drafting

import { execFileSync, execSync, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseBacklog } from '../ops/parse_backlog.ts';
import { runContractPipeline } from './contract_pipeline/orchestrator.ts';

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Valid source modes for contract generation */
type ContractSource = 'todo' | 'roadmap' | 'direct';

type CliArguments = {
  target?: string;
  source: ContractSource;
  resumeRunId?: string;
  background: boolean;
  dryRun: boolean;
  fresh: boolean;
  noAttach: boolean;
  ready: boolean;
  yolo: boolean;
  launcherToken?: string;
  help: boolean;
  root: boolean;
  dirty: boolean;
};

const parseArguments = (): CliArguments => {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const consumed = new Set<string>();
  for (const flag of ['--resume', '--launcher-token', '--source']) {
    const value = valueAfter(flag);
    if (value) {
      consumed.add(value);
    }
  }

  const sourceRaw = valueAfter('--source')?.toLowerCase();
  const source: ContractSource =
    sourceRaw === 'roadmap' || sourceRaw === 'direct' ? sourceRaw : 'todo';

  return {
    target: args.find((value) => !value.startsWith('-') && !consumed.has(value)),
    source,
    resumeRunId: valueAfter('--resume'),
    launcherToken: valueAfter('--launcher-token'),
    background: args.includes('--background'),
    dryRun: args.includes('--dry-run'),
    fresh: args.includes('--fresh'),
    noAttach: args.includes('--no-attach'),
    ready: args.includes('--ready'),
    yolo: args.includes('--yolo'),
    root: args.includes('--root') || args.includes('-r'),
    dirty: args.includes('--dirty'),
    help: args.length === 0 || args.includes('--help') || args.includes('-h'),
  };
};

const printHelp = (): void => {
  console.log(`
Usage:
  bun run contract [ID-or-Title] [--source <mode>] [options]

Source modes:
  --source todo     (default) Parse docs/TODO.md and generate contract from backlog item
  --source roadmap  Fetch from GitHub Issue or Project v2 item and freeze into contract
  --source direct   Initiate interactive Pi session for conversational contract drafting

Examples:
  bun run contract C-370
  bun run contract C-370 --source todo
  bun run contract "Fix LPC Paperdoll" --source todo
  bun run contract #102 --source roadmap
  bun run contract --source direct        # Auto-generate ID, launch writer pi session
  bun run contract C-370 --root
  bun run contract C-370 --root --dirty
  bun run contract --source direct --root  # Direct draft + root branch
  bun run contract docs/contracts/C-xxx-....md
  bun run contract --resume <run-id>

Options:
  --source <mode>   Source for contract generation: todo, roadmap, direct (default: todo)
  --root, -r        Start work on branch contract/C-XXX in the root repo before launching pipeline
  --dirty           Allow branch switch with uncommitted changes (only with --root)
  --resume <run-id> Resume an incomplete v3 run
  --dry-run          Resolve and create the manifest without starting Herdr/Pi
  --background       Internal/background mode; do not attach Herdr
  --fresh            Start a brand-new run (skip auto-resume)
  --no-attach        Run pipeline in background without attaching to herdr
  --ready            Create PR as ready-for-review (skip draft); triggers CodeRabbit immediately
  -h, --help         Show this help
`);
};

// ── Source Handlers ─────────────────────────────────────────

/** Run a gh command and return stdout. */
const gh = (args: string[], options?: { timeout?: number }): string => {
  const result = execSync(['gh', ...args].join(' '), {
    encoding: 'utf-8',
    timeout: options?.timeout ?? 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.trim();
};

/**
 * Handle --source roadmap: fetch a GitHub Issue or Project v2 item
 * and freeze it into a contract file.
 */
const handleRoadmapSource = (target: string): void => {
  const repoRoot = process.cwd();
  const contractsDir = join(repoRoot, 'docs/contracts');
  const templatePath = join(contractsDir, 'TEMPLATE.md');

  if (!existsSync(templatePath)) {
    console.error('❌ Contract template not found:', templatePath);
    process.exit(1);
  }

  // Resolve target: could be #<num>, C-<num>, or a GitHub URL
  let issueNum: number | undefined;
  let issueUrl: string | undefined;

  const urlMatch = target.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  if (urlMatch) {
    issueNum = Number(urlMatch[1]);
    issueUrl = target;
  } else if (/^\d+$/.test(target)) {
    issueNum = Number(target);
  } else if (target.toUpperCase().startsWith('C-') && /^\d+$/.test(target.slice(2))) {
    // C-XXX format — look up the issue from the backlog
    const backlog = parseBacklog(repoRoot);
    const item = backlog.items.find((i) => i.id === target.toUpperCase());
    if (item?.references) {
      const refMatch = item.references.match(/\/issues\/(\d+)/);
      if (refMatch) {
        issueNum = Number(refMatch[1]);
      }
    }
  } else {
    // Try as a project item search
    try {
      issueNum = resolveIssueFromProject(target);
    } catch {
      console.error(`❌ Could not resolve "${target}" to a GitHub Issue or Project item.`);
      console.error('   Use #<number>, a GitHub URL, or a C-XXX ID with a linked issue.');
      process.exit(1);
    }
  }

  if (!issueNum) {
    console.error(`❌ Could not resolve "${target}" to a GitHub Issue number.`);
    process.exit(1);
  }

  // Fetch the issue
  console.log(`📋 Fetching GitHub Issue #${issueNum}...`);
  let issueData: { title: string; body: string; number: number; url: string };
  try {
    const json = JSON.parse(
      gh(['issue', 'view', String(issueNum), '--json', 'number,title,body,url'], {
        timeout: 30_000,
      }),
    ) as { number: number; title: string; body: string; url: string };
    issueData = json;
    issueUrl = json.url;
  } catch {
    console.error(`❌ Failed to fetch GitHub Issue #${issueNum}`);
    process.exit(1);
  }

  // Resolve the owner from git remote if possible
  let owner = 'BearlySleeping';
  try {
    const remote = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const match = remote.match(/github\.com[/:]([^/]+)\//);
    if (match?.[1]) {
      owner = match[1];
    }
  } catch {
    // use default
  }

  // Generate contract ID: use next available number or derive from issue
  const existingContracts = existsSync(contractsDir)
    ? readdirSync(contractsDir).filter((f: string) => f.match(/^C-\d+/) && f.endsWith('.md'))
    : [];

  // Try to find an existing contract for this issue
  let contractId: string | undefined;
  let contractFileName: string | undefined;
  let contractPath: string | undefined;

  for (const file of existingContracts) {
    try {
      const content = readFileSync(join(contractsDir, file), 'utf-8');
      if (content.includes(`github.com/${owner}/`) && content.includes(`/issues/${issueNum}`)) {
        const idMatch = content.match(/^#\s+Contract\s+(C-\d+)/m);
        if (idMatch?.[1]) {
          contractId = idMatch[1];
          contractFileName = file;
          contractPath = join(contractsDir, file);
          break;
        }
      }
    } catch {
      // skip
    }
  }

  // If no existing contract, generate new ID and path
  if (!contractId) {
    const maxId = existingContracts.reduce((max: number, f: string) => {
      const match = f.match(/^C-(\d+)/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    contractId = `C-${maxId + 1}`;

    // Build slug from title
    const slug = issueData.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    contractFileName = `${contractId}-${slug}.md`;
    contractPath = join(contractsDir, contractFileName);
  }

  // Check if we found an existing contract — if so, reuse it
  const existingContractFound = existsSync(contractPath!);
  if (existingContractFound) {
    console.log(`✅ Contract already exists (reusing): ${contractFileName}`);
    console.log(`   Path: ${contractPath}`);
    console.log(`   Issue: ${issueUrl}`);
  } else {
    // Read template and generate new contract
    const template = readFileSync(templatePath, 'utf-8');

    // Generate contract content — fill YAML frontmatter + markdown template
    const now = new Date().toISOString();
    const contractContent = template
      .replace(/{FEATURE_CODE}/g, contractId)
      .replace(/{TITLE}/g, issueData.title)
      .replace(/{source}/g, 'roadmap')
      .replace(/{created_at}/g, now)
      .replace(/{reference_description}/g, `GitHub Issue [#${issueNum}](${issueUrl})`)
      .replace(/{path}/g, 'TBD — determined during implementation')
      .replace(/{brief description}/g, 'TBD')
      .replace(/{0\|1\|2\|3}/g, 'P1')
      .replace(/{one-line justification}/g, 'From GitHub Roadmap')
      .replace(/{list of contracts or packages this depends on}/g, 'None identified')
      .replace(
        /{what is broken or missing today — be concrete}/g,
        issueData.body.slice(0, 500) || 'See GitHub Issue for details.',
      )
      .replace(/{steps to reproduce the issue or observe the gap}/g, 'See GitHub Issue.')
      .replace(/{paths to code that already partially solves this}/g, 'TBD')
      .replace(/{what the existing code does NOT handle}/g, 'TBD')
      .replace(/{player\|creator\|developer}/g, 'player')
      .replace(/{e\.g\. "game start under 3s", "response under 500ms"}/g, 'TBD')
      .replace(/{what happens when AI\/network is unavailable}/g, 'TBD')
      .replace(
        /{the real user flow this unlocks — e\.g\. "player can create a character and enter the game world"}/g,
        'TBD',
      )
      .replace(/{capability}/g, 'TBD')
      .replace(/{file path or contract}/g, 'TBD')
      .replace(/{reuse \| modify \| replace}/g, 'check')
      .replace(
        /{2-4 sentences describing what this task is, what changes, and why it matters\.}/g,
        `From GitHub Issue [#${issueNum}](${issueUrl}):\n\n${issueData.body.slice(0, 800) || 'TBD'}`,
      );

    // Populate GitHub metadata in YAML frontmatter
    const finalContent = contractContent
      .replace(/issue_number:\s*null/, `issue_number: ${issueNum}`)
      .replace(/issue_url:\s*null/, `issue_url: "${issueUrl}"`);

    writeFileSync(contractPath!, finalContent);
    console.log(`✅ Contract frozen from roadmap: ${contractFileName}`);
    console.log(`   Path: ${contractPath}`);
    console.log(`   Issue: ${issueUrl}`);
  }
};

/** Search for an issue in Project v2 by title match. */
const resolveIssueFromProject = (searchTitle: string): number | undefined => {
  try {
    // Try to find the issue via project item list
    const projectList = gh(
      ['project', 'item-list', '1', '--owner', 'BearlySleeping', '--format', 'json'],
      {
        timeout: 30_000,
      },
    );
    const items = JSON.parse(projectList) as {
      items?: Array<{ content?: { title?: string; number?: number; url?: string } }>;
    };

    if (!items?.items) {
      return undefined;
    }

    const lowerSearch = searchTitle.toLowerCase();
    for (const item of items.items) {
      const title = item.content?.title ?? '';
      if (title.toLowerCase().includes(lowerSearch)) {
        const url = item.content?.url ?? '';
        const match = url.match(/\/issues\/(\d+)/);
        if (match) {
          return Number(match[1]);
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Prepare a --source direct contract pipeline run.
 *
 * Generates the next available contract ID, creates a minimal placeholder
 * contract on disk, and returns the ID. The pipeline writer stage then opens
 * in interactive TUI mode so the user can describe the feature directly.
 */
const prepareDirectSource = (repoRoot: string): string => {
  const contractsDir = join(repoRoot, 'docs/contracts');

  // Determine next contract ID from existing files on disk
  const existingContracts = existsSync(contractsDir)
    ? readdirSync(contractsDir).filter((f) => /^C-\d+/.test(f) && f.endsWith('.md'))
    : [];
  const maxId = existingContracts.reduce((max: number, f: string) => {
    const match = f.match(/^C-(\d+)/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const contractId = `C-${maxId + 1}`;

  // Create a minimal placeholder so resolveContract() can find it.
  // The writer pi session will call contract_generate to create the
  // full v2 contract shell and fill it in based on user input.
  const placeholderPath = join(contractsDir, `${contractId}.md`);
  const placeholder = [
    `# Contract ${contractId}: Direct Draft`,
    '',
    '> ⚠️ Placeholder created by `--source direct`. The writer will call',
    '> `contract_generate` to create the full contract shell, then complete',
    '> every section based on the feature you describe in the chat.',
    '',
    '| **Status** | draft |',
    '',
  ].join('\n');

  mkdirSync(contractsDir, { recursive: true });
  writeFileSync(placeholderPath, placeholder);

  console.log(
    [
      '',
      '═══════════════════════════════════════════',
      `  Contract ID: ${contractId}`,
      '═══════════════════════════════════════════',
      '',
      'A writer pi session will open in a moment.',
      'Describe your feature in the chat and the writer',
      'will create the full contract specification.',
      '',
      '═══════════════════════════════════════════',
      '',
    ].join('\n'),
  );

  return contractId;
};

// ── Root Branch Checkout ────────────────────────────────────

/**
 * Set up a root-directory branch for contract work instead of a worktree.
 * Derives branch name `contract/C-XXX` from the contract target.
 * Validates dirty state unless --dirty is passed.
 */
const setupRootBranch = (options: {
  target: string;
  allowDirty: boolean;
}): { branchName: string; wasDirty: boolean } => {
  // Derive branch name from contract ID and validate format
  const contractId = options.target.toUpperCase();
  const branchName = `contract/${contractId}`;

  // Validate branch name format (must be contract/C-NNN)
  if (!/^contract\/C-\d+$/.test(branchName)) {
    throw new Error(
      `Invalid contract branch name: "${branchName}". Must match contract/C-NNN format.`,
    );
  }

  // Check for dirty working directory
  let wasDirty = false;
  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    wasDirty = status.length > 0;
  } catch {
    throw new Error('Not a git repository. --root requires a git working tree.');
  }

  if (wasDirty && !options.allowDirty) {
    console.error(
      [
        '❌ Error: Working directory is dirty.',
        '',
        'Uncommitted changes: run `git status` to review.',
        '',
        'Options:',
        '  1. Commit or stash your changes: `git stash`',
        '  2. Re-run with --dirty to switch branches with uncommitted changes:',
        `     bun run contract ${options.target} --root --dirty`,
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  // Check if we're already on the target branch
  let currentBranch = '';
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // not fatal
  }

  if (currentBranch === branchName) {
    console.log(`✅ Already on branch \`${branchName}\`.`);
    return { branchName, wasDirty };
  }

  // Check if branch already exists
  let branchExists = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', branchName], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    branchExists = true;
  } catch {
    // doesn't exist — create it
  }

  if (branchExists) {
    console.log(`🔄 Switching to existing branch \`${branchName}\`...`);
  } else {
    console.log(`🌿 Creating branch \`${branchName}\` in root directory...`);
  }

  try {
    const args = branchExists ? ['checkout', branchName] : ['checkout', '-b', branchName];
    execFileSync('git', args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`✅ Now on branch \`${branchName}\`.`);

    if (wasDirty) {
      console.log('⚠️  Uncommitted changes were carried over to the new branch.');
    }

    return { branchName, wasDirty };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to switch to branch ${branchName}: ${msg}`);
  }
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
    .filter(
      (value) =>
        value !== '--background' &&
        value !== '--no-attach' &&
        value !== '--root' &&
        value !== '-r' &&
        value !== '--dirty',
    );
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

  // Handle --source modes that don't use the full pipeline
  if (cli.source === 'roadmap' && cli.target) {
    handleRoadmapSource(cli.target);
    return;
  }

  // --source direct: generate contract ID + placeholder, then fall through
  // to the pipeline. The writer stage opens in interactive TUI mode.
  let interactiveWriter = false;
  if (cli.source === 'direct') {
    cli.target = prepareDirectSource(process.cwd());
    interactiveWriter = true;
  }

  // --root mode: switch branch directly in root repo instead of using worktrees
  if (cli.root) {
    if (!cli.target) {
      console.error('❌ --root requires a contract ID (e.g. bun run contract C-370 --root)');
      process.exit(1);
    }
    const { branchName } = setupRootBranch({
      target: cli.target,
      allowDirty: cli.dirty,
    });
    console.log(`📁 Root checkout complete on \`${branchName}\`.`);
    console.log(
      '   Pipeline will launch from this branch (worktrees may still be used by stages).',
    );
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
    ready: cli.ready,
    yolo: cli.yolo,
    interactiveWriter,
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
