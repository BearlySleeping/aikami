#!/usr/bin/env bun
// scripts/src/lib/agents/contract_pipeline.ts
//
// Contract Pipeline CLI — entry point for `bun run contract`.
//   bun run contract                       → prompt source (interactive writer draft)
//   bun run contract C-370                 → existing contract (path source, default)
//   bun run contract --source issue #54    → freeze contract from a GitHub Issue
//   bun run contract --source todo C-370   → parse docs/TODO.md (legacy)

import { execFileSync, execSync, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { assertHerdrCompatible } from '../herdr/session.ts';
import { parseBacklog } from '../ops/parse_backlog.ts';
import { resolveContract } from './contract_pipeline/contract_resolver.ts';
import { readManifest } from './contract_pipeline/manifest_store.ts';
import { runContractPipeline } from './contract_pipeline/orchestrator.ts';

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Valid source modes for contract generation. */
type ContractSource = 'prompt' | 'issue' | 'todo' | 'path';

type CliArguments = {
  target?: string;
  source: ContractSource;
  issueTarget?: string;
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
  /** Internal — forwarded by the launcher to the background child so the
   *  writer stage stays interactive (user describes the feature in the TUI). */
  interactiveWriter: boolean;
  /** Run the critique stage before implementation on a path-sourced (already
   *  authored) contract, which otherwise skips both authoring stages. */
  critique: boolean;
};

const parseArguments = (): CliArguments => {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const consumed = new Set<string>();
  for (const flag of ['--resume', '--launcher-token', '--source', '--issue']) {
    const value = valueAfter(flag);
    if (value) {
      consumed.add(value);
    }
  }

  const positionalTarget = args.find((value) => !value.startsWith('-') && !consumed.has(value));

  // Resolve the source mode. The --source value is either a keyword
  // (prompt|issue|todo|path) or a contract path/ID (e.g. docs/contracts/C-372.md).
  const sourceRaw = valueAfter('--source')?.trim();
  const sourceKey = sourceRaw?.toLowerCase();

  let source: ContractSource;
  let target = positionalTarget;
  if (sourceKey === 'issue' || sourceKey === 'roadmap') {
    // roadmap → issue (renamed). Both freeze a contract from GitHub.
    source = 'issue';
  } else if (sourceKey === 'todo') {
    source = 'todo';
  } else if (sourceKey === 'path') {
    source = 'path';
  } else if (sourceKey === 'prompt' || sourceKey === 'direct') {
    // direct → prompt (renamed). Both open the interactive writer.
    source = 'prompt';
  } else if (sourceRaw) {
    // --source <path-or-ID>: the value IS the contract → path mode.
    source = 'path';
    target = sourceRaw;
  } else if (target) {
    // No --source flag but a target was passed (C-XXX or a contract path) →
    // default to using the existing contract.
    source = 'path';
  } else {
    // No --source flag and no target → interactive direct draft.
    source = 'prompt';
  }

  return {
    target,
    source,
    issueTarget: valueAfter('--issue'),
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
    interactiveWriter: args.includes('--interactive-writer'),
    critique: args.includes('--critique'),
    help: args.includes('--help') || args.includes('-h'),
  };
};

const printHelp = (): void => {
  console.log(`
Usage:
  bun run contract [target] [--source <mode>] [options]

Modes (--source):
  prompt   Open the interactive writer — you describe the feature in the chat
           and the writer drafts the contract (default when no target is given).
  issue    Freeze a contract from a GitHub Issue/Roadmap item. Requires a
           target: issue number (#54), URL, or C-XXX with a linked issue.
  <path>   Use an existing contract: a file path (docs/contracts/C-372.md) or
           a bare ID (C-372, looked up in docs/contracts/). Skips the writer
           and critique stages — starts at implementation/verification.
  todo     Legacy: parse docs/TODO.md for the backlog item.

Targets:
  C-XXX                  Look up an existing contract in docs/contracts/ (default).
  docs/contracts/C-XXX-slug.md   Path to an existing contract file.
  #54 | issue URL        With --source issue: the GitHub Issue to freeze.

Defaults:
  bun run contract                     → prompt source (new contract, interactive writer)
  bun run contract C-370               → path source (existing contract)
  bun run contract --source direct ... → prompt (legacy alias)
  bun run contract --source roadmap .. → issue (legacy alias)

Examples:
  bun run contract                          # Interactive direct draft
  bun run contract --source prompt --root   # Same, but on a root branch
  bun run contract --source issue 54        # Freeze from Issue #54
  bun run contract --source issue https://github.com/BearlySleeping/aikami/issues/54
  bun run contract C-370 --root             # Run an existing contract on a root branch
  bun run contract C-377 --critique         # Critique a hand-authored contract, then implement
  bun run contract docs/contracts/C-370-fix-lpc-paperdoll-....md
  bun run contract --source todo C-370      # Legacy: parse docs/TODO.md
  bun run contract --resume <run-id>

Options:
  --issue <url|#>      Alias for --source issue.
  --source <mode>      prompt (default), issue, todo, or a contract path/ID.
  --root, -r           Start work on branch contract/C-XXX in the root repo.
  --dirty              Allow branch switch with uncommitted changes (only with --root).
  --critique           Run the critic over an already-authored contract before
                       implementation. Only meaningful with a contract target
                       (which otherwise skips both authoring stages).
  --resume <run-id>    Resume an incomplete run.
  --fresh              Start a brand-new run (skip auto-resume).
  --dry-run            Resolve and create the manifest without starting Herdr/Pi.
  --background         Internal/background mode; do not attach Herdr.
  --no-attach          Run pipeline in background without attaching to herdr.
  --ready              Create PR as ready-for-review (skip draft); triggers CodeRabbit immediately.
  --yolo               Fully automated pipeline — no human in the review loop.
  -h, --help           Show this help.
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
 * Handle --source issue: fetch a GitHub Issue or Project v2 item
 * and freeze it into a contract file.
 */
const handleIssueSource = (target: string): string => {
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
  if (!contractPath || !contractId) {
    throw new Error('contractPath or contractId not set');
  }
  const existingContractFound = existsSync(contractPath);
  if (existingContractFound) {
    console.log(`✅ Contract already exists (reusing): ${contractFileName}`);
    console.log(`   Path: ${contractPath}`);
    console.log(`   Issue: ${issueUrl}`);
    return contractId;
  } else {
    // Read template and generate new contract
    const template = readFileSync(templatePath, 'utf-8');

    // Generate contract content — fill YAML frontmatter + markdown template
    const now = new Date().toISOString();
    const contractContent = template
      .replace(/{FEATURE_CODE}/g, contractId)
      .replace(/{TITLE}/g, issueData.title)
      .replace(/{source}/g, 'issue')
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

    writeFileSync(contractPath, finalContent);
    console.log(`✅ Contract frozen from issue: ${contractFileName}`);
    console.log(`   Path: ${contractPath}`);
    console.log(`   Issue: ${issueUrl}`);
  }

  return contractId;
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
 * Prepare a --source prompt (direct draft) contract pipeline run.
 *
 * Generates the next available contract ID, creates a minimal placeholder
 * contract on disk, and returns the ID. The pipeline writer stage then opens
 * in interactive TUI mode so the user can describe the feature directly.
 */
const prepareDirectSource = (repoRoot: string): string => {
  const contractsDir = join(repoRoot, 'docs/contracts');

  // Determine next contract ID from existing files on disk.
  // 🔴 This runs in the FOREGROUND only. The background child receives the
  // resolved ID from the launcher (forwarded as a positional arg) and never
  // re-derives it — re-deriving here picks the first C-XXX.md placeholder
  // alphabetically (e.g. a stale C-371.md), not the one just created.
  const existingContracts = existsSync(contractsDir)
    ? readdirSync(contractsDir).filter((f) => /^C-\d+/.test(f) && f.endsWith('.md'))
    : [];

  // Reuse an orphaned placeholder from an interrupted direct-draft run — but
  // ONLY when it is still a genuine placeholder (heading "Direct Draft" +
  // the source marker). Real contracts (e.g. C-371.md with a real title)
  // are never reused. Newest first, so a fresh orphan wins over an old one.
  const stalePlaceholders = existingContracts
    .filter((f) => /^C-\d+\.md$/.test(f))
    .map((f) => join(contractsDir, f))
    .filter((p) => {
      try {
        const content = readFileSync(p, 'utf-8');
        return (
          /^#\s+Contract\s+C-\d+:\s*Direct Draft/m.test(content) &&
          (content.includes('Placeholder created by `--source prompt`') ||
            content.includes('Placeholder created by `--source direct`'))
        );
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (stalePlaceholders[0]) {
    const reusedId = basename(stalePlaceholders[0], '.md');
    console.log(`♻️  Reusing orphaned placeholder: ${reusedId}.md`);
    return reusedId;
  }

  const maxId = existingContracts.reduce((max: number, f: string) => {
    const match = f.match(/^C-(\d+)/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const contractId = `C-${maxId + 1}`;

  // Create a minimal placeholder so resolveContract() can find it.
  // The interactive writer pi session waits for the user's feature
  // description, then renames this to C-XXX-<slug>.md and fills it in.
  const placeholderPath = join(contractsDir, `${contractId}.md`);
  const placeholder = [
    `# Contract ${contractId}: Direct Draft`,
    '',
    '> ⚠️ Placeholder created by `--source prompt`. The writer will rename',
    `> this file to \`${contractId}-<slug>.md\` and complete every section`,
    '> based on the feature you describe in the chat.',
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
      `will write the contract to docs/contracts/${contractId}-<slug>.md.`,
      '',
      '═══════════════════════════════════════════',
      '',
    ].join('\n'),
  );

  return contractId;
};

// ── Root Branch Checkout ────────────────────────────────────

/**
 * Detect uncommitted changes in the working tree.
 * Only modifications, staged changes, and conflicts count — untracked
 * files (??) don't block branch switches.
 */
const detectDirty = (): boolean => {
  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return status.split('\n').some((line) => line.length > 2 && !line.startsWith('??'));
  } catch {
    throw new Error('Not a git repository. --root requires a git working tree.');
  }
};

/** Reconstruct the current command with --dirty appended (retry hint). */
const retryWithDirtyHint = (): string => {
  const args = process.argv.slice(2).filter((value) => value !== '--dry-run');
  return `bun run contract ${args.join(' ')} --dirty`.replace(/\s+/g, ' ').trim();
};

/**
 * Fail fast when --root would switch a dirty tree. Run BEFORE any file is
 * created (placeholder, frozen contract) so the user isn't left with a
 * half-created contract when the branch switch would have been blocked.
 */
const assertRootTreeClean = (options: { allowDirty: boolean }): void => {
  if (options.allowDirty) {
    return;
  }
  if (!detectDirty()) {
    return;
  }
  console.error(
    [
      '❌ Error: Working directory is dirty.',
      '',
      'Uncommitted changes: run `git status` to review.',
      '',
      'Options:',
      '  1. Commit or stash your changes: `git stash`',
      '  2. Re-run with --dirty to continue with uncommitted changes:',
      `     ${retryWithDirtyHint()}`,
      '',
    ].join('\n'),
  );
  process.exit(1);
};

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

  // Check for dirty working directory — only modifications, staged changes,
  // and conflicts count. Untracked files (??) don't block branch switches.
  let wasDirty = false;
  try {
    wasDirty = detectDirty();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
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
        '  2. Re-run with --dirty to continue with uncommitted changes:',
        `     ${retryWithDirtyHint()}`,
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

const launchBackground = async (options: {
  noAttach: boolean;
  /** Resolved direct-draft contract ID (e.g. C-372) to forward to the child. */
  target?: string;
  /** Forward so the child keeps the writer stage interactive. */
  interactiveWriter?: boolean;
  /** Resolved CLI source mode (prompt/issue/path) to forward to the child. */
  source?: ContractSource;
}): Promise<void> => {
  const token = `launch-${Date.now().toString(36)}-${process.pid}`;
  const runsDirectory = join(process.cwd(), '.pi/contract-runs');
  mkdirSync(runsDirectory, { recursive: true });
  const readyPath = join(runsDirectory, `${token}.json`);
  const launcherLogPath = join(runsDirectory, `${token}.log`);
  const descriptor = openSync(launcherLogPath, 'a');
  // Forward ALL user args (including --root/--dirty) so the background child
  // runs with the same configuration. setupRootBranch is idempotent — the
  // child detects it is already on the branch and proceeds. Stripped from the
  // forward: launcher-only flags (--background/--no-attach) and the raw
  // `--source <value>` pair — the resolved source mode is re-added below via
  // sourceArgs, so forwarding the original would emit a duplicate `--source`
  // (harmless today because valueAfter() takes the first match, but fragile).
  const forwarded = process.argv.slice(2).filter((value, index, arr) => {
    if (value === '--background' || value === '--no-attach') {
      return false;
    }
    if (value === '--source' || arr[index - 1] === '--source') {
      return false;
    }
    return true;
  });
  // 🔴 Forward the resolved direct-draft target so the child uses the EXACT
  // same contract ID instead of re-deriving a placeholder (which could pick
  // a stale file and start the pipeline at the wrong stage).
  const targetArgs = options.target && !forwarded.includes(options.target) ? [options.target] : [];
  const writerArgs = options.interactiveWriter ? ['--interactive-writer'] : [];
  // 🔴 Forward the resolved source mode so the child re-parses as source='prompt'
  // for default prompt runs, preserving interactiveWriter and preventing
  // skipAuthoring from advancing directly to implementation.
  const sourceArgs = options.source ? ['--source', options.source] : [];
  const child = spawn(
    'bun',
    [
      'run',
      import.meta.path,
      ...forwarded,
      ...targetArgs,
      ...writerArgs,
      ...sourceArgs,
      '--background',
      '--launcher-token',
      token,
    ],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', descriptor, descriptor],
      env: process.env,
    },
  );
  child.unref();
  closeSync(descriptor);

  // The child can legitimately need well beyond 30s to become ready:
  // initialize() runs bootstrapWorktree, which does a full git checkout +
  // `bun install --frozen-lockfile` — a cold bun cache takes minutes. A
  // fixed 30s deadline burned the launcher while the detached child kept
  // running (and kept holding the contract lock), manufacturing a phantom
  // "already running" deadlock on the next attempt. Distinguish the two
  // cases: child exited → fail fast with the log tail; child alive → keep
  // waiting (180s cap) with progress output.
  const deadline = Date.now() + 180_000;
  let lastProgress = 0;
  while (!existsSync(readyPath)) {
    if (child.exitCode !== null) {
      const diagnostic = existsSync(launcherLogPath)
        ? readFileSync(launcherLogPath, 'utf-8').slice(-4_000)
        : 'No launcher log was produced.';
      throw new Error(
        `Pipeline exited before becoming ready (code ${child.exitCode}).\n${diagnostic}`,
      );
    }
    if (Date.now() >= deadline) {
      const diagnostic = existsSync(launcherLogPath)
        ? readFileSync(launcherLogPath, 'utf-8').slice(-4_000)
        : 'No launcher log was produced.';
      throw new Error(`Pipeline did not become ready within 180s.\n${diagnostic}`);
    }
    await sleep(250);
    if (Date.now() - lastProgress > 10_000) {
      lastProgress = Date.now();
      console.log('⏳ Waiting for pipeline to become ready…');
    }
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

  // 🔴 Preflight: herdr client/server protocol skew (old server still running
  // after a herdr update) makes EVERY herdr call fail with protocol_mismatch
  // — the pipeline then crashes with a confusing "herdr worktree create
  // failed" error after burning 180s waiting for readiness. Detect it before
  // creating any placeholder/contract file or spawning the background child.
  // Skipped for modes that never touch herdr (issue freeze, dry-run).
  const needsHerdr = !cli.dryRun && !cli.issueTarget && cli.source !== 'issue';
  if (needsHerdr) {
    try {
      await assertHerdrCompatible();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${msg}`);
      process.exit(1);
    }
  }

  // 🔴 Resume hydration: when continuing an incomplete run, remember the
  // original invocation. The run manifest persists rootMode (and the contract
  // target), so `bun run contract --resume <run-id>` without re-passing
  // `--root` still executes on the root branch (contract/C-XXX) instead of
  // silently switching to a worktree. setupRootBranch below is idempotent —
  // it detects the existing branch and checks out the current one.
  if (cli.resumeRunId) {
    try {
      const resumed = readManifest({ runId: cli.resumeRunId, cwd: process.cwd() });
      if (resumed) {
        if (resumed.rootMode) {
          cli.root = true;
          // Resuming on the root branch must not be blocked by the tree state
          // left behind when the session stopped — that state IS the run's
          // state (mid-implement working tree).
          cli.dirty = true;
        }
        if (!cli.target) {
          cli.target = resumed.contractId;
        }
      }
    } catch {
      // Non-fatal — the orchestrator re-reads and validates the manifest.
    }
  }

  // 🔴 Fail fast BEFORE creating any placeholder or contract file: --root
  // switches branches, so a dirty working tree blocks unless --dirty is
  // passed. Checking up front means a failed run leaves no C-XXX.md behind.
  // setupRootBranch re-checks later (idempotent), and the background child
  // inherits the same flags from the launcher.
  if (cli.root) {
    assertRootTreeClean({ allowDirty: cli.dirty });
  }

  // --issue: freeze contract from GitHub Issue (no pipeline)
  if (cli.issueTarget) {
    const contractId = handleIssueSource(cli.issueTarget);
    if (cli.root) {
      setupRootBranch({
        target: contractId,
        allowDirty: cli.dirty,
      });
      console.log(`📁 Root checkout complete for ${contractId}.`);
    }
    return;
  }

  // Handle --source modes that don't use the full pipeline: --source issue
  // freezes a contract from GitHub (same as --issue).
  if (cli.source === 'issue') {
    if (!cli.target) {
      console.error(
        '❌ --source issue requires a target: an issue number (#54), a URL, or a C-XXX with a linked issue.',
      );
      process.exit(1);
    }
    handleIssueSource(cli.target);
    return;
  }

  // ── Prompt source: fresh direct draft → interactive writer ──
  // The default when no target is given. Creates a placeholder contract and
  // opens the writer pi session in interactive TUI mode so the user can
  // describe the feature in the chat.
  //
  // 🔴 Only the foreground derives a fresh ID. The background child receives
  // the resolved target + --interactive-writer from the launcher and never
  // re-runs prepareDirectSource (that would pick the wrong placeholder).
  let interactiveWriter = false;
  let skipAuthoring = false;
  if (cli.source === 'prompt' && !cli.resumeRunId) {
    if (!cli.target) {
      cli.target = prepareDirectSource(process.cwd());
    }
    interactiveWriter = true;
  } else if (cli.source === 'path') {
    // Existing contract passed by path or bare C-XXX. Skip the contract-
    // authoring stages (writer + critique) and start at implementation
    // (or later, per the contract's status). The contract must already
    // exist on disk — path mode does not fall back to the backlog.
    skipAuthoring = true;
    if (!cli.target) {
      console.error(
        '❌ --source path requires a contract path or ID (e.g. docs/contracts/C-370.md).',
      );
      process.exit(1);
    }
    try {
      const resolved = resolveContract({ target: cli.target, repoRoot: process.cwd() });
      if (!existsSync(resolved.path)) {
        console.error(`❌ Contract not found on disk: ${resolved.path}`);
        console.error('   Create it first with `bun run contract` (interactive writer)');
        console.error('   or `bun run contract --source issue <#|url>` (freeze from GitHub).');
        process.exit(1);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${msg}`);
      process.exit(1);
    }
  }
  // The background child inherits the interactive flag from the launcher
  // (target was forwarded, so the branch above does not re-derive).
  interactiveWriter = interactiveWriter || (cli.interactiveWriter && cli.source === 'prompt');

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
    await launchBackground({
      noAttach: cli.noAttach,
      target: cli.target,
      interactiveWriter,
      source: cli.source,
    });
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
    skipAuthoring,
    critique: cli.critique,
    rootMode: cli.root,
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
