// biome-ignore-all lint/style/useNamingConvention: HerDr API field names (snake_case) — must match external API contract
// scripts/src/lib/agents/contract_pipeline.ts
/**
 * Stable Contract Pipeline — single-file Herdr-orchestrated pipeline.
 *
 * Replaces the old swarm (architect → coder → qa → review_gate → git) with
 * a prompt-template-driven pipeline:
 *
 *   Contract Writer ↔ Contract Critic (up to 3 loops)
 *               ↓
 *          Implementer ↔ Verifier (up to 3 loops)
 *               ↓
 *       Review Captain (persistent interactive Pi tab)
 *
 * Stage completion is detected by PARSING PANE OUTPUT for verdict sections,
 * not by fs.watch or handoff JSON files.
 *
 * Usage:
 *   bun run contract C-312                  # from TODO.md
 *   bun run contract <path-to-contract>     # existing contract file
 *   bun run contract "raw description"      # create contract from user input
 *   bun run contract C-312 --fresh           # regenerate draft + restart
 *   bun run contract C-312 --background      # run detached, don't join
 *   bun run contract C-312 --resume <run-id> # resume interrupted run
 *
 * Never commits, pushes, stages files, or invokes Git.
 * Never uses review_gate.ts, git_commit.ts, or /approve.
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

// ── Types ───────────────────────────────────────────────────

/** Pipeline stages (excluding terminal states). */
type PipelineStage =
  | 'generate_draft'
  | 'write_contract'
  | 'critique'
  | 'implement'
  | 'verify'
  | 'review'
  | 'blocked'
  | 'done';

/** Verdict extracted from a worker's completion report. */
type StageVerdict = {
  writer?: { next: string; files?: string[]; summary?: string };
  critique?: { verdict: 'APPROVE' | 'CHANGES_REQUESTED' | 'NEEDS_CLARIFICATION'; summary?: string };
  implementer?: { acStatus: Record<string, string>; filesChanged: string[]; summary?: string };
  verifier?: { verdict: 'PASS' | 'CHANGES_REQUESTED'; acEvidence?: string; summary?: string };
};

/** Run manifest stored at .pi/contract-runs/<run-id>/manifest.json */
type RunManifest = {
  runId: string;
  contractId: string;
  contractPath: string;
  startTime: string;
  lastUpdated: string;
  currentStage: PipelineStage;
  loopCount: { critic: number; verify: number };
  stages: Record<string, { startTime?: string; endTime?: string; verdict?: string }>;
  reviewPaneId: string;
  pipelinePaneId: string;
  workspaceId: string;
};

/** Stage metadata for the state machine table. */
type StageDef = {
  stage: PipelineStage;
  promptCommand: string; // e.g. "/contract-create docs/contracts/C-312-slug.md"
  completionRegex: RegExp; // regex to match the verdict section header
  verdictParser: (text: string) => StageVerdict;
  timeoutMs: number;
  label: string; // herdr tab label prefix, e.g. "writer"
};

// ── Constants ───────────────────────────────────────────────

const MAX_CRITIC_LOOPS = 3;
const MAX_VERIFY_LOOPS = 3;
const WORKSPACE_LABEL_PREFIX = 'aikami-contract-';

// Timeouts (ms)
const WRITER_TIMEOUT_MS = 20 * 60 * 1000; // 20 min
const CRITIC_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
const IMPLEMENTER_TIMEOUT_MS = 45 * 60 * 1000; // 45 min
const VERIFIER_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const FOLLOWUP_TIMEOUT_MS = 2 * 60 * 1000; // 2 min
const PI_STARTUP_GRACE_MS = 5_000;

const CONTRACTS_DIR = 'docs/contracts';
const TODO_PATH = 'docs/TODO.md';
const RUNS_DIR = '.pi/contract-runs';

// ── CLI Argument Parsing ────────────────────────────────────

type CliArgs = {
  target: string;
  fresh: boolean;
  background: boolean;
  resume: string | null;
  help: boolean;
};

const parseArgs = (): CliArgs => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { target: '', fresh: false, background: false, resume: null, help: true };
  }

  // First non-flag arg is the target
  const target = args.find((a) => !a.startsWith('--')) ?? '';
  const fresh = args.includes('--fresh');
  const background = args.includes('--background');
  const resumeIdx = args.indexOf('--resume');
  const resume = resumeIdx >= 0 ? (args[resumeIdx + 1] ?? null) : null;

  return { target: target.replace(/^['"]|['"]$/g, ''), fresh, background, resume, help: false };
};

// ── Herdr CLI Helpers (pattern: spawn-based, per swarm_director.ts) ─

type HerdrResult = { code: number; stdout: string };

const herdr = (args: string[]): Promise<HerdrResult> =>
  new Promise((resolveH) => {
    const proc = spawn('herdr', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout?.on('data', (d) => {
      out += String(d);
    });
    proc.on('close', (code) => resolveH({ code: code ?? 1, stdout: out }));
  });

const herdrJson = async <T>(args: string[]): Promise<T | null> => {
  const r = await herdr(args);
  if (r.code !== 0 || !r.stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(r.stdout.trim()) as T;
  } catch {
    return null;
  }
};

const isServerRunning = async (): Promise<boolean> => {
  const r = await herdr(['status', 'server']);
  return r.code === 0 && /status:\s*running/i.test(r.stdout);
};

const ensureServer = async (): Promise<void> => {
  if (await isServerRunning()) {
    return;
  }
  const proc = spawn('herdr', ['server'], { stdio: 'ignore', env: process.env });
  proc.unref();
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning()) {
      return;
    }
  }
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
  throw new Error('herdr server did not start within timeout');
};

// ── Contract Resolution ─────────────────────────────────────

type ContractInfo = {
  id: string;
  title: string;
  path: string;
  status: string; // draft | approved | implemented | verified | completed
};

/**
 * Find or generate a contract from a target.
 * - C-XXX: parse TODO.md, find/generate contract file
 * - path ending in .md: use as contract path directly
 * - other text: treat as raw user requirement
 */
const resolveContract = (target: string, cwd: string, fresh: boolean): ContractInfo => {
  const contractsDir = join(cwd, CONTRACTS_DIR);

  // Case 1: Explicit contract path
  if (target.endsWith('.md')) {
    const absPath = resolve(cwd, target);
    if (!existsSync(absPath)) {
      throw new Error(`Contract file not found: ${target}`);
    }
    const content = readFileSync(absPath, 'utf-8');
    const idMatch = content.match(/^#\s+Contract\s+(C-\d+|MIG-\d+):\s*(.+)/m);
    const statusMatch = content.match(/\|\s*\*\*Status\*\*\s*\|\s*(\S+)\s*\|/);
    return {
      id: idMatch?.[1] ?? 'unknown',
      title: idMatch?.[2]?.trim() ?? target,
      path: absPath,
      status: statusMatch?.[1]?.trim() ?? 'draft',
    };
  }

  // Case 2: TODO.md ID (C-XXX or MIG-XXX)
  const todoIdMatch = target.match(/^(C-\d+|MIG-\d+)$/i);
  if (todoIdMatch) {
    const id = todoIdMatch[0]?.toUpperCase();
    const todoPath = join(cwd, TODO_PATH);

    if (!existsSync(todoPath)) {
      throw new Error(`docs/TODO.md not found. Cannot resolve ${id}.`);
    }

    // Find existing contract
    let existingFile: string | null = null;
    try {
      const files = readdirSync(contractsDir);
      existingFile =
        files.find((f) => f.startsWith(`${id}-`) && f.endsWith('.md') && f !== 'TEMPLATE.md') ??
        null;
    } catch {
      /* directory may not exist */
    }

    if (existingFile && !fresh) {
      const absPath = join(contractsDir, existingFile);
      const content = readFileSync(absPath, 'utf-8');
      const statusMatch = content.match(/\|\s*\*\*Status\*\*\s*\|\s*(\S+)\s*\|/);
      const titleMatch = content.match(/^#\s+Contract\s+(?:C-\d+|MIG-\d+):\s*(.+)/m);
      return {
        id,
        title: titleMatch?.[1]?.trim() ?? existingFile,
        path: absPath,
        status: statusMatch?.[1]?.trim() ?? 'draft',
      };
    }

    // Generate draft from TODO.md
    const contractPath = generateDraft(id, todoPath, contractsDir, fresh);
    const generatedContent = readFileSync(contractPath, 'utf-8');
    const titleMatch = generatedContent.match(/^#\s+Contract\s+(?:C-\d+|MIG-\d+):\s*(.+)/m);
    return {
      id,
      title: titleMatch?.[1]?.trim() ?? id,
      path: contractPath,
      status: 'draft',
    };
  }

  // Case 3: Raw text — generate from scratch
  const slug = target
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const rawId = `RAW-${Date.now().toString(36)}`;
  const fileName = `${rawId}-${slug}.md`;
  const contractPath = join(contractsDir, fileName);

  const templatePath = join(contractsDir, 'TEMPLATE.md');
  let template: string;
  if (existsSync(templatePath)) {
    template = readFileSync(templatePath, 'utf-8');
  } else {
    template = [
      `# Contract ${rawId}: {TITLE}`,
      '',
      '## Metadata',
      '',
      '| Field | Value |',
      '|---|---|',
      '| **Source** | Raw input |',
      '| **Target** | TBD |',
      '| **Priority** | P2 |',
      '| **Dependencies** | — |',
      '| **Status** | draft |',
      '| **Contract version** | 2.0.0 |',
      '',
      '## Overview',
      '',
      target,
      '',
    ].join('\n');
  }

  template = template.replace(/\{FEATURE_CODE\}/g, rawId).replace(/\{TITLE\}/g, target);
  const replaceRow = (label: string, value: string): void => {
    template = template.replace(
      new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|[^\\n]*\\|`),
      `| **${label}** | ${value} |`,
    );
  };
  replaceRow('Source', 'Raw input');
  replaceRow('Status', 'draft');
  replaceRow('Contract version', '2.0.0');

  mkdirSync(contractsDir, { recursive: true });
  writeFileSync(contractPath, template);

  return { id: rawId, title: target, path: contractPath, status: 'draft' };
};

/**
 * Generate a draft contract v2.0.0 from a TODO.md item.
 * Uses the canonical template (docs/contracts/TEMPLATE.md).
 */
const generateDraft = (
  id: string,
  todoPath: string,
  contractsDir: string,
  fresh: boolean,
): string => {
  const templatePath = join(contractsDir, 'TEMPLATE.md');

  if (!existsSync(templatePath)) {
    throw new Error('docs/contracts/TEMPLATE.md not found.');
  }

  const todoContent = readFileSync(todoPath, 'utf-8');

  // Find the item heading: ### C-312 — Title
  const headingRe = new RegExp(
    `###\\s+${id}\\s+[–—\\-]\\s+(.+)\\n([\\s\\S]*?)(?=\\n###\\s+(?:C-|MIG-)|$)`,
    'm',
  );
  const itemMatch = todoContent.match(headingRe);

  if (!itemMatch) {
    throw new Error(
      `${id} not found in docs/TODO.md. Run contract_scan_backlog to see available IDs.`,
    );
  }

  const title = (itemMatch[1] ?? '').trim();
  const body = itemMatch[2] ?? '';

  // Extract fields from bullet lines
  const rawFields: Record<string, string> = {};
  const fieldRe = /^-\s+\*\*(.+?):\*\*\s+(.+)/gm;
  let fm: RegExpExecArray | null;
  while (true) {
    fm = fieldRe.exec(body);
    if (fm === null) {
      break;
    }
    rawFields[(fm[1] ?? '').trim()] = (fm[2] ?? '').trim();
  }
  const getField = (name: string): string => rawFields[name] ?? '';
  const firstLine = (text: string): string => (text ?? '').split('\n')[0]?.trim() ?? '';

  // Build slug
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');

  const fileName = `${id}-${slug}.md`;
  const filePath = join(contractsDir, fileName);

  // If file exists and not --fresh, don't overwrite
  if (existsSync(filePath) && !fresh) {
    return filePath;
  }

  // If --fresh: delete old file first
  if (fresh && existsSync(filePath)) {
    unlinkSync(filePath);
  }

  let template = readFileSync(templatePath, 'utf-8');

  // Step 1: Global heading placeholders
  template = template.replace(/\{FEATURE_CODE\}/g, id).replace(/\{TITLE\}/g, title);

  // Step 2: Rewrite metadata table rows
  const replaceRow = (label: string, value: string): void => {
    template = template.replace(
      new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|[^\\n]*\\|`),
      `| **${label}** | ${value} |`,
    );
  };

  replaceRow('Source', `TODO.md — ${id}`);
  replaceRow('Target', `${firstLine(getField('Target')) || 'TBD'} — TBD`);
  replaceRow('Priority', getField('Priority') || 'P2');
  replaceRow('Dependencies', getField('Dependencies') || '—');
  replaceRow('Status', 'draft');
  replaceRow('Contract version', '2.0.0');
  replaceRow('Docs Impact', 'TBD');

  // Step 3: Fill overview
  template = template.replace(
    /\{2-4 sentences describing what this task is[^}]*\}/,
    firstLine(getField('Outcome')) || title,
  );

  // Step 4: Fill problem baseline
  template = template.replace(
    /\{what is broken or missing today[^}]*\}/,
    `${title} — see docs/TODO.md for details.`,
  );

  mkdirSync(contractsDir, { recursive: true });
  writeFileSync(filePath, template);

  return filePath;
};

// ── Stage Verdict Parsers ───────────────────────────────────

/**
 * Parse the Writer's completion section.
 * Regex: /## Contract Writer Summary/ ... /Next:/m
 */
const parseWriterVerdict = (text: string): StageVerdict => {
  const nextMatch = text.match(/Next:\s*(.+)/i);
  const fileSection = text.match(/##\s*Contract Writer Summary[\s\S]*?(?=##|$)/i);

  return {
    writer: {
      next: nextMatch?.[1]?.trim() ?? '/contract-critique for adversarial review',
      summary: fileSection?.[0]?.slice(0, 1000),
    },
  };
};

/**
 * Parse the Critic's verdict section.
 * Regex: /## Critique Verdict: (APPROVE|CHANGES_REQUESTED|NEEDS_CLARIFICATION)/m
 */
const parseCriticVerdict = (text: string): StageVerdict => {
  const verdictMatch = text.match(
    /##\s*Critique Verdict:\s*(APPROVE|CHANGES_REQUESTED|NEEDS_CLARIFICATION)/i,
  );
  const strengthsMatch = text.match(/###\s*Strengths[\s\S]*?(?=###|$)/i);
  const criticalMatch = text.match(/###\s*Critical Issues[\s\S]*?(?=###|$)/i);

  if (!verdictMatch) {
    return {
      critique: { verdict: 'CHANGES_REQUESTED', summary: 'No verdict section found in output.' },
    };
  }

  return {
    critique: {
      verdict: verdictMatch[1]?.toUpperCase() as
        | 'APPROVE'
        | 'CHANGES_REQUESTED'
        | 'NEEDS_CLARIFICATION',
      summary: [strengthsMatch?.[0], criticalMatch?.[0]].filter(Boolean).join('\n').slice(0, 2000),
    },
  };
};

/**
 * Parse the Implementer's Execution Report.
 * Regex: /## Execution Report/ ... /### AC Status/m
 */
const parseImplementerVerdict = (text: string): StageVerdict => {
  const reportMatch = text.match(/##\s*Execution Report[\s\S]*/i);
  const acSection = reportMatch?.[0]?.match(/###\s*AC Status[\s\S]*?(?=###|$)/i);

  // Parse AC status table: | AC-1 | ✅/⚠️/❌ | Notes |
  const acStatus: Record<string, string> = {};
  if (acSection) {
    const rows = acSection[0].matchAll(/\|\s*(AC-\d+|AC\d+)\s*\|\s*(✅|⚠️|⚠|❌)\s*\|/g);
    for (const row of rows) {
      const acKey = row[1];
      const acVal = row[2];
      if (acKey && acVal) {
        acStatus[acKey] = acVal;
      }
    }
  }

  return {
    implementer: {
      acStatus,
      summary: reportMatch?.[0]?.slice(0, 2000),
      filesChanged: [],
    },
  };
};

/**
 * Parse the Verifier's verdict section.
 * Regex: /## Verification Verdict: (PASS|CHANGES_REQUESTED)/m
 */
const parseVerifierVerdict = (text: string): StageVerdict => {
  const verdictMatch = text.match(
    /##\s*(?:✅|⚠|❌)?\s*(?:Verification\s+)?Verdict:\s*(PASS|CHANGES_REQUESTED|VERIFIED|NOT_VERIFIED|FAILED)/i,
  );
  const acTable = text.match(/###\s*AC (?:Summary|Evidence|Status)[\s\S]*?(?=###|$)/i);

  if (!verdictMatch) {
    return {
      verifier: { verdict: 'CHANGES_REQUESTED', summary: 'No verdict section found in output.' },
    };
  }

  const rawVerdict = verdictMatch[1]?.toUpperCase() ?? '';
  // Normalize: VERIFIED → PASS, FAILED / NOT_VERIFIED → CHANGES_REQUESTED
  const normalized: 'PASS' | 'CHANGES_REQUESTED' =
    rawVerdict === 'VERIFIED' || rawVerdict === 'PASS' ? 'PASS' : 'CHANGES_REQUESTED';

  return {
    verifier: {
      verdict: normalized,
      acEvidence: acTable?.[0],
      summary: verdictMatch[0]?.slice(0, 1000),
    },
  };
};

// ── Run Manifest ─────────────────────────────────────────────

const createManifest = (
  contractId: string,
  contractPath: string,
  workspaceId: string,
  reviewPaneId: string,
  pipelinePaneId: string,
  startStage: PipelineStage,
): RunManifest => {
  const runId = `run-${Date.now().toString(36)}-${contractId.replace(/[^A-Za-z0-9]/g, '-')}`;
  return {
    runId,
    contractId,
    contractPath,
    startTime: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    currentStage: startStage,
    loopCount: { critic: 0, verify: 0 },
    stages: {},
    reviewPaneId,
    pipelinePaneId,
    workspaceId,
  };
};

const writeManifest = (manifest: RunManifest, cwd: string): void => {
  const dir = join(cwd, RUNS_DIR, manifest.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
};

const readManifest = (runId: string, cwd: string): RunManifest | null => {
  const path = join(cwd, RUNS_DIR, runId, 'manifest.json');
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
};

// ── Pipeline Log ─────────────────────────────────────────────

const logPath = (runId: string, cwd: string): string => join(cwd, RUNS_DIR, runId, 'pipeline.log');

const pipelineLog = (runId: string, cwd: string, msg: string): void => {
  const path = logPath(runId, cwd);
  mkdirSync(join(cwd, RUNS_DIR, runId), { recursive: true });
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    writeFileSync(path, `${line}\n`, { flag: 'a' });
  } catch {
    /* best effort */
  }
};

// ── Lock file (concurrent-run guard) ────────────────────────

const lockPath = (contractId: string, cwd: string): string =>
  join(cwd, RUNS_DIR, `lock_${contractId.replace(/[^A-Za-z0-9]/g, '-')}.pid`);

/** Registered cleanup callbacks for active locks. Keyed by lock file path. */
const _lockCleanups = new Map<string, () => void>();

const acquireLock = (contractId: string, cwd: string): void => {
  const path = lockPath(contractId, cwd);
  mkdirSync(join(cwd, RUNS_DIR), { recursive: true });

  if (existsSync(path)) {
    let pid: number | null = null;
    try {
      pid = Number(readFileSync(path, 'utf-8').trim());
    } catch {
      /* ignore */
    }
    if (pid && !Number.isNaN(pid)) {
      try {
        process.kill(pid, 0);
        throw new Error(
          `Pipeline already running for ${contractId} (PID ${pid}).\nAttach with: herdr session attach default\nForce restart: bun run contract ${contractId} --fresh`,
        );
      } catch (e) {
        if (e instanceof Error && e.message.includes('Pipeline already running')) {
          throw e;
        }
        // PID is stale — clean up
        unlinkSync(path);
      }
    }
  }

  writeFileSync(path, String(process.pid));

  const cleanup = (): void => {
    try {
      unlinkSync(path);
    } catch {
      /* already gone */
    }
  };
  _lockCleanups.set(path, cleanup);
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
};

/** Release the lock AND deregister cleanup handlers. Call before forking. */
const releaseLock = (contractId: string, cwd: string): void => {
  const path = lockPath(contractId, cwd);
  const cleanup = _lockCleanups.get(path);
  if (cleanup) {
    process.removeListener('exit', cleanup);
    process.removeListener('SIGINT', cleanup);
    process.removeListener('SIGTERM', cleanup);
    _lockCleanups.delete(path);
  }
  try {
    unlinkSync(path);
  } catch {
    /* already gone */
  }
};

// ── Herdr Workspace & Tab Provisioning ──────────────────────

type WorkspaceCreateResult = {
  result: {
    workspace: { workspace_id: string };
    tab: { id: string };
    root_pane: { pane_id: string };
  };
};

type TabCreateResult = {
  result: { tab: { tab_id: string }; root_pane: { pane_id: string } };
};

type WorkspaceListResult = {
  result: { workspaces: Array<{ workspace_id: string; label: string }> };
};

type TabListResult = {
  result: { tabs: Array<{ tab_id: string; label: string }> };
};

type PaneListResult = {
  result: { panes: Array<{ pane_id: string; tab_id: string }> };
};

type PaneGetResult = {
  result: { pane: { pane_id: string; agent?: string; agent_status?: string } };
};

const findWorkspace = async (label: string): Promise<string | null> => {
  const r = await herdrJson<WorkspaceListResult>(['workspace', 'list']);
  const ws = r?.result?.workspaces?.find((w) => w.label === label);
  return ws?.workspace_id ?? null;
};

const findTab = async (workspaceId: string, label: string): Promise<string | null> => {
  const r = await herdrJson<TabListResult>(['tab', 'list', '--workspace', workspaceId]);
  const tab = r?.result?.tabs?.find((t) => t.label === label);
  return tab?.tab_id ?? null;
};

const getPanes = async (
  workspaceId: string,
): Promise<Array<{ pane_id: string; tab_id: string }>> => {
  const r = await herdrJson<PaneListResult>(['pane', 'list', '--workspace', workspaceId]);
  return r?.result?.panes ?? [];
};

/**
 * Create a Herdr workspace for the contract pipeline.
 * Returns workspace_id, review_pane_id, pipeline_pane_id.
 */
const createWorkspace = async (
  _contractId: string,
  taskId: string,
  cwd: string,
): Promise<{
  workspaceId: string;
  reviewPaneId: string;
  pipelinePaneId: string;
}> => {
  const workspaceLabel = `${WORKSPACE_LABEL_PREFIX}${taskId}`;

  // Check if workspace already exists
  let workspaceId = await findWorkspace(workspaceLabel);

  if (workspaceId) {
    // Verify tabs exist
    let reviewPaneId: string | null = null;
    let pipelinePaneId: string | null = null;

    const reviewTabId = await findTab(workspaceId, 'review');
    if (reviewTabId) {
      const panes = await getPanes(workspaceId);
      reviewPaneId = panes.find((p) => p.tab_id === reviewTabId)?.pane_id ?? null;
    }

    const pipelineTabId = await findTab(workspaceId, 'pipeline');
    if (pipelineTabId) {
      const panes = await getPanes(workspaceId);
      pipelinePaneId = panes.find((p) => p.tab_id === pipelineTabId)?.pane_id ?? null;
    }

    if (reviewPaneId && pipelinePaneId) {
      console.log(`[pipeline] Reusing existing workspace: ${workspaceId}`);
      return { workspaceId, reviewPaneId, pipelinePaneId };
    }

    // Need to create missing tabs
    if (!reviewPaneId) {
      const r = await herdrJson<TabCreateResult>([
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--cwd',
        cwd,
        '--label',
        'review',
        '--no-focus',
      ]);
      if (r?.result) {
        reviewPaneId = r.result.root_pane.pane_id;
      }
    }
    if (!pipelinePaneId) {
      const logFile = logPath(taskId, cwd);
      // Touch log file so tail doesn't error
      mkdirSync(join(cwd, RUNS_DIR, taskId), { recursive: true });
      if (!existsSync(logFile)) {
        writeFileSync(logFile, '');
      }
      const r = await herdrJson<TabCreateResult>([
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--cwd',
        cwd,
        '--label',
        'pipeline',
        '--no-focus',
      ]);
      if (r?.result) {
        pipelinePaneId = r.result.root_pane.pane_id;
        await herdr(['pane', 'run', pipelinePaneId, `tail -f ${logFile}`]);
      }
    }

    return {
      workspaceId,
      reviewPaneId: reviewPaneId ?? '',
      pipelinePaneId: pipelinePaneId ?? '',
    };
  }

  // Create new workspace
  const createResult = await herdrJson<WorkspaceCreateResult>([
    'workspace',
    'create',
    '--cwd',
    cwd,
    '--label',
    workspaceLabel,
    '--no-focus',
  ]);

  if (!createResult?.result) {
    throw new Error(`Failed to create workspace: ${workspaceLabel}`);
  }

  workspaceId = createResult.result.workspace.workspace_id;
  const reviewPaneId = createResult.result.root_pane.pane_id;

  // Rename default tab to review
  await herdr(['tab', 'rename', `${workspaceId}:1`, 'review']);

  // Create pipeline tab
  const logFile = logPath(taskId, cwd);
  mkdirSync(join(cwd, RUNS_DIR, taskId), { recursive: true });
  if (!existsSync(logFile)) {
    writeFileSync(logFile, '');
  }

  let pipelinePaneId = '';
  const pipelineTab = await herdrJson<TabCreateResult>([
    'tab',
    'create',
    '--workspace',
    workspaceId,
    '--cwd',
    cwd,
    '--label',
    'pipeline',
    '--no-focus',
  ]);
  if (pipelineTab?.result) {
    pipelinePaneId = pipelineTab.result.root_pane.pane_id;
    await herdr(['pane', 'run', pipelinePaneId, `tail -f ${logFile}`]);
  }

  return { workspaceId, reviewPaneId, pipelinePaneId };
};

// ── Worker Tab Creation ──────────────────────────────────────

/**
 * Create a worker tab with the given label and start Pi.
 * Returns the pane_id for the worker.
 */
const createWorkerPane = async (
  workspaceId: string,
  label: string,
  cwd: string,
): Promise<string> => {
  const tabResult = await herdrJson<TabCreateResult>([
    'tab',
    'create',
    '--workspace',
    workspaceId,
    '--cwd',
    cwd,
    '--label',
    label,
    '--no-focus',
  ]);

  if (!tabResult?.result) {
    throw new Error(`Failed to create tab: ${label}`);
  }

  return tabResult.result.root_pane.pane_id;
};

// ── Worker Stage Runner ──────────────────────────────────────

/**
 * Run a Pi worker stage:
 * 1. Start pi in the pane
 * 2. Wait for it to be idle
 * 3. Send the prompt command
 * 4. Wait for it to become idle/done again (work complete)
 * 5. Read the pane output
 * 6. Parse the verdict
 * 7. Return the verdict
 *
 * If no verdict found: send one follow-up, wait again.
 */
const runWorkerStage = async (
  paneId: string,
  promptCommand: string,
  cwd: string,
  timeoutMs: number,
  completionRegex: RegExp,
  verdictParser: (text: string) => StageVerdict,
): Promise<{ verdict: StageVerdict; paneOutput: string; timedOut: boolean }> => {
  // ── Kill any existing agent in this pane ──
  const paneInfo = await herdrJson<PaneGetResult>(['pane', 'get', paneId]);
  if (paneInfo?.result?.pane?.agent) {
    console.debug(`[pipeline:worker] killing existing agent in pane ${paneId}`);
    await herdr(['pane', 'send-keys', paneId, 'C-c']);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const check = await herdrJson<PaneGetResult>(['pane', 'get', paneId]);
      if (!check?.result?.pane?.agent) {
        break;
      }
    }
  }

  // ── Start pi ──
  await herdr(['pane', 'run', paneId, `cd '${cwd}' && pi`]);
  console.debug('[pipeline:worker] pi started');

  // ── Wait for pi to be idle (ready for prompt) ──
  const idleCode = await herdr([
    'wait',
    'agent-status',
    paneId,
    '--status',
    'idle',
    '--timeout',
    '30000',
  ]);
  if (idleCode.code !== 0) {
    console.warn('[pipeline:worker] pi did not reach idle within 30s — continuing anyway');
    await new Promise((r) => setTimeout(r, PI_STARTUP_GRACE_MS));
  }

  // ── Send the prompt as agent input (NOT pane run — that runs a shell command) ──
  await herdr(['pane', 'send-text', paneId, promptCommand]);
  await herdr(['pane', 'send-keys', paneId, 'Enter']);
  console.debug(`[pipeline:worker] prompt sent: ${promptCommand.slice(0, 100)}`);

  // ── Wait for agent to start working, then complete ──
  // Per herdr docs: for background panes, wait for `working` first to
  // confirm the prompt was received, then `done`.  Waiting for `idle`
  // races — the agent may be idle from startup and match instantly.
  let waitResult = await herdr([
    'wait',
    'agent-status',
    paneId,
    '--status',
    'working',
    '--timeout',
    '30000',
  ]);

  if (waitResult.code !== 0) {
    // Never entered working — may already be done (instant task) or
    // prompt was never processed (fatal).  Check current status.
    const check = await herdrJson<PaneGetResult>(['pane', 'get', paneId]);
    if (check?.result?.pane?.agent_status === 'done') {
      // Already completed — fall through to read
    } else {
      // Last resort: foreground pattern (idle → done)
      waitResult = await herdr([
        'wait',
        'agent-status',
        paneId,
        '--status',
        'idle',
        '--timeout',
        String(timeoutMs),
      ]);
      if (waitResult.code !== 0) {
        waitResult = await herdr([
          'wait',
          'agent-status',
          paneId,
          '--status',
          'done',
          '--timeout',
          String(timeoutMs),
        ]);
      }
    }
  } else {
    // Agent is working — poll until done, idle, or blocked.
    // Polling is required because herdr wait is a single-status call;
    // a blocked agent (e.g. ask_user_question) would otherwise silently
    // consume the full timeout before timing out.
    const pollIntervalMs = 10_000;
    const deadline = Date.now() + timeoutMs;
    let agentDone = false;
    let agentBlocked = false;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const check = await herdrJson<PaneGetResult>(['pane', 'get', paneId]);
      const status = check?.result?.pane?.agent_status;

      if (status === 'done' || status === 'idle') {
        agentDone = true;
        break;
      }
      if (status === 'blocked') {
        agentBlocked = true;
        pipelineLog(
          '',
          cwd,
          `[pipeline:worker] AGENT BLOCKED — pi is waiting for user input (e.g. ask_user_question). ` +
            `Attach with: herdr session attach default`,
        );
        // Try sending a notification via herdr
        await herdr([
          'notification',
          'send',
          `Contract pipeline: agent blocked in ${paneId}. Attach to herdr to answer questions.`,
          '--level',
          'warn',
        ]).catch(() => {});
        // Try to unblock: send "Continue without asking" or similar
        // but this is fragile — just report and stop
        break;
      }
      // still working — continue polling
    }

    if (agentBlocked) {
      // Don't set waitResult — return directly with blocked verdict
      const blockedVerdict: StageVerdict = {
        implementer: { acStatus: {}, filesChanged: [], summary: 'Agent blocked — requires user interaction.' },
      };
      return { verdict: blockedVerdict, paneOutput: '', timedOut: true };
    }

    // Read pane output (even if timed out — might have partial work)
    const readResult2 = await herdr([
      'pane',
      'read',
      paneId,
      '--source',
      'recent-unwrapped',
      '--lines',
      '500',
    ]);
    const _paneOutput2 = readResult2.stdout;

    if (agentDone) {
      // Check for verdict in output
      if (completionRegex.test(_paneOutput2)) {
        return { verdict: verdictParser(_paneOutput2), paneOutput: _paneOutput2, timedOut: false };
      }
    }

    // If we get here: timed out or no verdict found, fall through to follow-up
    pipelineLog(
      '',
      cwd,
      `[pipeline:worker] agent did not produce completion verdict — sending follow-up`,
    );
    return { verdict: {}, paneOutput: _paneOutput2, timedOut: true };
  }

  if (waitResult.code !== 0) {
    console.warn(`[pipeline:worker] timeout waiting for agent completion`);
  }

  // ── Read pane output ──
  const readResult = await herdr([
    'pane',
    'read',
    paneId,
    '--source',
    'recent-unwrapped',
    '--lines',
    '500',
  ]);
  const paneOutput = readResult.stdout;

  // ── Parse verdict ──
  const verdict = verdictParser(paneOutput);

  if (completionRegex.test(paneOutput)) {
    return { verdict, paneOutput, timedOut: false };
  }

  // ── No verdict found — send ONE follow-up ──
  console.debug('[pipeline:worker] no verdict found — sending follow-up');
  await herdr([
    'pane',
    'send-text',
    paneId,
    'Please write your completion summary now. Include the verdict section as specified in your prompt.',
  ]);
  await herdr(['pane', 'send-keys', paneId, 'Enter']);

  // Wait for follow-up to be processed (working → done)
  let followupWait = await herdr([
    'wait',
    'agent-status',
    paneId,
    '--status',
    'working',
    '--timeout',
    '30000',
  ]);

  if (followupWait.code !== 0) {
    const check = await herdrJson<PaneGetResult>(['pane', 'get', paneId]);
    if (check?.result?.pane?.agent_status !== 'done') {
      // Fallback: idle → done
      followupWait = await herdr([
        'wait',
        'agent-status',
        paneId,
        '--status',
        'idle',
        '--timeout',
        String(FOLLOWUP_TIMEOUT_MS),
      ]);
      if (followupWait.code !== 0) {
        followupWait = await herdr([
          'wait',
          'agent-status',
          paneId,
          '--status',
          'done',
          '--timeout',
          String(FOLLOWUP_TIMEOUT_MS),
        ]);
      }
    }
  } else {
    followupWait = await herdr([
      'wait',
      'agent-status',
      paneId,
      '--status',
      'done',
      '--timeout',
      String(FOLLOWUP_TIMEOUT_MS),
    ]);
    if (followupWait.code !== 0) {
      // Foreground pane fallback
      followupWait = await herdr([
        'wait',
        'agent-status',
        paneId,
        '--status',
        'idle',
        '--timeout',
        '30000',
      ]);
    }
  }

  const followupRead = await herdr([
    'pane',
    'read',
    paneId,
    '--source',
    'recent-unwrapped',
    '--lines',
    '500',
  ]);
  const followupOutput = followupRead.stdout;
  const followupVerdict = verdictParser(followupOutput);

  if (completionRegex.test(followupOutput)) {
    return { verdict: followupVerdict, paneOutput: followupOutput, timedOut: false };
  }

  // Still no verdict — timed out / blocked
  return { verdict, paneOutput: followupOutput, timedOut: true };
};

// ── Review Captain Setup ─────────────────────────────────────

/**
 * Set up the Review Captain in the review pane:
 * 1. Start Pi
 * 2. Wait for idle
 * 3. Send /contract-review-captain command
 */
const setupReviewCaptain = async (
  reviewPaneId: string,
  taskId: string,
  cwd: string,
): Promise<void> => {
  // Kill any existing agent
  const paneInfo = await herdrJson<PaneGetResult>(['pane', 'get', reviewPaneId]);
  if (paneInfo?.result?.pane?.agent) {
    await herdr(['pane', 'send-keys', reviewPaneId, 'C-c']);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Start Pi with a unique session ID
  await herdr([
    'pane',
    'run',
    reviewPaneId,
    `cd '${cwd}' && pi --session-id contract-${taskId}-review`,
  ]);

  // Wait for idle
  await herdr(['wait', 'agent-status', reviewPaneId, '--status', 'idle', '--timeout', '30000']);
  await new Promise((r) => setTimeout(r, 2000));

  // Send the review captain prompt as agent input
  await herdr(['pane', 'send-text', reviewPaneId, `/contract-review-captain ${taskId}`]);
  await herdr(['pane', 'send-keys', reviewPaneId, 'Enter']);

  console.log('[pipeline:review-captain] initialized');
};

/**
 * Send a progress update to the Review Captain pane.
 */
const sendReviewUpdate = async (
  reviewPaneId: string,
  manifest: RunManifest,
  _cwd: string,
): Promise<void> => {
  const { currentStage, loopCount, contractId } = manifest;
  const contractPath = manifest.contractPath;

  // Read the contract for its title
  let title = contractId;
  try {
    const content = readFileSync(contractPath, 'utf-8');
    const titleMatch = content.match(/^#\s+Contract\s+(?:C-\d+|MIG-\d+):\s*(.+)/m);
    if (titleMatch) {
      title = titleMatch[1]?.trim();
    }
  } catch {
    /* ignore */
  }

  const msg = [
    '## Pipeline Progress Update',
    '',
    `**Contract**: ${contractId} — ${title}`,
    `**Current Stage**: ${currentStage}`,
    `**Critic Loops**: ${loopCount.critic}/${MAX_CRITIC_LOOPS}`,
    `**Verify Loops**: ${loopCount.verify}/${MAX_VERIFY_LOOPS}`,
    `**Run ID**: ${manifest.runId}`,
  ].join('\n');

  await herdr(['pane', 'send-text', reviewPaneId, msg]);
  await herdr(['pane', 'send-keys', reviewPaneId, 'Enter']);
};

/**
 * Send the final structured summary to the Review Captain.
 */
const sendFinalSummary = async (
  reviewPaneId: string,
  manifest: RunManifest,
  _cwd: string,
): Promise<void> => {
  const contractPath = manifest.contractPath;
  let title = manifest.contractId;
  let acSection = '';

  try {
    const content = readFileSync(contractPath, 'utf-8');
    const titleMatch = content.match(/^#\s+Contract\s+(?:C-\d+|MIG-\d+):\s*(.+)/m);
    if (titleMatch) {
      title = titleMatch[1]?.trim();
    }

    // Try to extract AC status from the execution report
    const acMatch = content.match(/###\s*AC Status[\s\S]*?(?=###|$)/i);
    if (acMatch) {
      acSection = acMatch[0];
    }
  } catch {
    /* ignore */
  }

  const msg = [
    '## Pipeline Complete — Final Summary',
    '',
    `**Contract**: ${manifest.contractId} — ${title}`,
    `**Contract Status**: ${manifest.currentStage === 'done' ? 'verified' : manifest.currentStage}`,
    `**Run ID**: ${manifest.runId}`,
    '',
    '### AC Status',
    acSection || '_(see contract file for AC status)_',
    '',
    '### Pipeline Stages',
    ...Object.entries(manifest.stages).map(
      ([stage, info]) =>
        `- **${stage}**: ${info.verdict ?? 'no verdict'} (${info.endTime ? `completed ${info.endTime}` : 'incomplete'})`,
    ),
    '',
    '### Next Steps',
    'Review the contract, make finishing touches, and request commit/push when ready.',
  ].join('\n');

  await herdr(['pane', 'send-text', reviewPaneId, msg]);
  await herdr(['pane', 'send-keys', reviewPaneId, 'Enter']);
};

// ── Stage Definitions ────────────────────────────────────────

// Matches "Contract Writer Summary", "Completion Summary", etc.
const WRITER_COMPLETION_RE =
  /##\s*(?:Contract\s+Writer\s+)?(?:Completion|Contract Writer|Writer)\s+Summary/;
const CRITIC_COMPLETION_RE =
  /##\s*Critique Verdict:\s*(APPROVE|CHANGES_REQUESTED|NEEDS_CLARIFICATION)/i;
const IMPLEMENTER_COMPLETION_RE = /##\s*Execution Report/;
// Matches "Verification Verdict: PASS", "## ✅ Verdict: VERIFIED", etc.
const VERIFIER_COMPLETION_RE =
  /##\s*(?:✅|⚠|❌)?\s*(?:Verification\s+)?Verdict:\s*(PASS|CHANGES_REQUESTED|VERIFIED|NOT_VERIFIED|FAILED)/i;

const STAGE_DEFS: Record<string, StageDef> = {
  write_contract: {
    stage: 'write_contract',
    promptCommand: '', // filled dynamically with contract path
    completionRegex: WRITER_COMPLETION_RE,
    verdictParser: parseWriterVerdict,
    timeoutMs: WRITER_TIMEOUT_MS,
    label: 'writer',
  },
  critique: {
    stage: 'critique',
    promptCommand: '', // filled dynamically
    completionRegex: CRITIC_COMPLETION_RE,
    verdictParser: parseCriticVerdict,
    timeoutMs: CRITIC_TIMEOUT_MS,
    label: 'critic',
  },
  implement: {
    stage: 'implement',
    promptCommand: '', // filled dynamically
    completionRegex: IMPLEMENTER_COMPLETION_RE,
    verdictParser: parseImplementerVerdict,
    timeoutMs: IMPLEMENTER_TIMEOUT_MS,
    label: 'implement',
  },
  verify: {
    stage: 'verify',
    promptCommand: '', // filled dynamically
    completionRegex: VERIFIER_COMPLETION_RE,
    verdictParser: parseVerifierVerdict,
    timeoutMs: VERIFIER_TIMEOUT_MS,
    label: 'verify',
  },
};

// ── State Machine ────────────────────────────────────────────

type PipelineCtx = {
  manifest: RunManifest;
  contractInfo: ContractInfo;
  workspaceId: string;
  reviewPaneId: string;
  pipelinePaneId: string;
  cwd: string;
};

const transition = (ctx: PipelineCtx, next: PipelineStage): void => {
  const oldStage = ctx.manifest.currentStage;
  ctx.manifest.currentStage = next;
  ctx.manifest.lastUpdated = new Date().toISOString();
  if (ctx.manifest.stages[oldStage]) {
    const oldEntry = ctx.manifest.stages[oldStage];
    if (oldEntry) {
      oldEntry.endTime = new Date().toISOString();
    }
  }
  writeManifest(ctx.manifest, ctx.cwd);
};

const runStage = async (
  ctx: PipelineCtx,
  stageKey: string,
  attemptLabel: string,
  feedbackContext: string = '',
): Promise<StageVerdict> => {
  const def = STAGE_DEFS[stageKey];
  if (!def) {
    throw new Error(`Unknown stage: ${stageKey}`);
  }

  const manifest = ctx.manifest;

  // Create worker pane
  const label = `${def.label}-${attemptLabel}`;
  const paneId = await createWorkerPane(ctx.workspaceId, label, ctx.cwd);

  // Build prompt command with contract path
  const contractPath = manifest.contractPath;
  let promptCmd: string;
  if (stageKey === 'write_contract') {
    promptCmd = `/contract-create ${contractPath}`;
  } else if (stageKey === 'critique') {
    promptCmd = `/contract-critique ${contractPath}${feedbackContext ? `\n\n${feedbackContext}` : ''}`;
  } else if (stageKey === 'implement') {
    promptCmd = `/contract ${contractPath}${feedbackContext ? `\n\n${feedbackContext}` : ''}`;
  } else if (stageKey === 'verify') {
    promptCmd = `/contract-verify ${contractPath}`;
  } else {
    throw new Error(`Unknown stage: ${stageKey}`);
  }

  pipelineLog(manifest.runId, ctx.cwd, `STAGE START: ${stageKey} (attempt ${attemptLabel})`);
  pipelineLog(manifest.runId, ctx.cwd, `  Pane: ${paneId}`);
  pipelineLog(manifest.runId, ctx.cwd, `  Command: ${promptCmd}`);

  // Record stage start
  if (!manifest.stages[stageKey]) {
    manifest.stages[stageKey] = {};
  }
  const stageEntry = manifest.stages[stageKey];
  if (stageEntry) {
    stageEntry.startTime = new Date().toISOString();
  }
  writeManifest(manifest, ctx.cwd);

  // Send stage start update to review captain
  await sendReviewUpdate(ctx.reviewPaneId, manifest, ctx.cwd);

  // Run the worker
  const {
    verdict,
    paneOutput: _paneOutput,
    timedOut,
  } = await runWorkerStage(
    paneId,
    promptCmd,
    ctx.cwd,
    def.timeoutMs,
    def.completionRegex,
    def.verdictParser,
  );

  // Record stage end
  const endEntry = manifest.stages[stageKey];
  if (endEntry) {
    endEntry.endTime = new Date().toISOString();
  }

  if (timedOut) {
    const blockedEntry = manifest.stages[stageKey];
    if (blockedEntry) {
      blockedEntry.verdict = 'BLOCKED: no completion section found';
    }
    pipelineLog(manifest.runId, ctx.cwd, `STAGE BLOCKED: ${stageKey} — no verdict section found`);
  } else {
    const verdictSummary = JSON.stringify(verdict).slice(0, 200);
    const verdictEntry = manifest.stages[stageKey];
    if (verdictEntry) {
      verdictEntry.verdict = verdictSummary;
    }
    pipelineLog(manifest.runId, ctx.cwd, `STAGE COMPLETE: ${stageKey} — ${verdictSummary}`);
  }

  writeManifest(manifest, ctx.cwd);
  await sendReviewUpdate(ctx.reviewPaneId, manifest, ctx.cwd);

  return verdict;
};

// ── Main Pipeline Orchestrator ──────────────────────────────

const runPipeline = async (cli: CliArgs): Promise<void> => {
  const cwd = process.cwd();

  // ── Resolve contract ──
  const contractInfo = resolveContract(cli.target, cwd, cli.fresh);
  console.log(`📄 Contract: ${contractInfo.id} — ${contractInfo.title}`);
  console.log(`   Path: ${contractInfo.path}`);
  console.log(`   Status: ${contractInfo.status}`);

  // ── Concurrent-run guard ──
  acquireLock(contractInfo.id, cwd);

  // ── Ensure Herdr is running ──
  await ensureServer();

  // ── Determine task ID (contract ID, sanitized) ──
  const taskId = contractInfo.id.replace(/[^A-Za-z0-9]/g, '-');

  // ── Handle --resume ──
  let resumeManifest: RunManifest | null = null;
  let startStage: PipelineStage = 'generate_draft';

  if (cli.resume) {
    resumeManifest = readManifest(cli.resume, cwd);
    if (!resumeManifest) {
      throw new Error(`Run manifest not found: ${cli.resume}`);
    }
    console.log(`♻️  Resuming run: ${resumeManifest.runId}`);
    console.log(`   Last stage: ${resumeManifest.currentStage}`);
    startStage = resumeManifest.currentStage;
    // Bypass generate_draft logic — contract already exists
    pipelineLog(resumeManifest.runId, cwd, `RESUMING from stage: ${startStage}`);
  }

  // ── Determine starting stage based on contract status ──
  if (!resumeManifest) {
    switch (contractInfo.status) {
      case 'draft':
        startStage = 'write_contract';
        break;
      case 'approved':
        startStage = 'implement';
        break;
      case 'implemented':
        startStage = 'verify';
        break;
      case 'verified':
      case 'completed':
        startStage = 'review';
        break;
      default:
        startStage = 'write_contract';
    }
  }

  // ── Create/locate Herdr workspace ──
  const { workspaceId, reviewPaneId, pipelinePaneId } = await createWorkspace(
    contractInfo.id,
    taskId,
    cwd,
  );

  // ── Create or load run manifest ──
  let manifest: RunManifest;
  if (resumeManifest) {
    manifest = resumeManifest;
    manifest.lastUpdated = new Date().toISOString();
    manifest.currentStage = startStage;
    writeManifest(manifest, cwd);
  } else {
    manifest = createManifest(
      contractInfo.id,
      contractInfo.path,
      workspaceId,
      reviewPaneId,
      pipelinePaneId,
      startStage,
    );
    writeManifest(manifest, cwd);
  }

  const ctx: PipelineCtx = {
    manifest,
    contractInfo,
    workspaceId,
    reviewPaneId,
    pipelinePaneId,
    cwd,
  };

  // ── Set up Review Captain (always, even on resume) ──
  pipelineLog(manifest.runId, cwd, 'Setting up Review Captain...');
  await setupReviewCaptain(reviewPaneId, taskId, cwd);

  // ── Touch pipeline log for tail -f (redirect to run-specific path) ──
  mkdirSync(join(cwd, RUNS_DIR, manifest.runId), { recursive: true });
  const runLogFile = logPath(manifest.runId, cwd);
  if (!existsSync(runLogFile)) {
    writeFileSync(runLogFile, '');
  }
  // Kill the placeholder tail and start watching the real run log
  await herdr(['pane', 'send-keys', pipelinePaneId, 'C-c']);
  await new Promise((r) => setTimeout(r, 500));
  await herdr(['pane', 'run', pipelinePaneId, `tail -f ${runLogFile}`]);

  // ── Join mode: attach user to herdr ──
  if (!cli.background) {
    try {
      const { execSync } = await import('node:child_process');
      console.log(
        '\n  Attaching to herdr review tab (Ctrl+C here will NOT kill the pipeline)...\n',
      );

      // Release the parent's lock so the child can acquire its own
      releaseLock(contractInfo.id, cwd);

      // Detach pipeline before joining
      const logFile = logPath(manifest.runId, cwd);
      const logFd = openSync(logFile, 'a');

      // Fork a detached process that continues the pipeline
      const child = spawn(
        'bun',
        ['run', process.argv[1] ?? '', ...process.argv.slice(2), '--background'],
        { detached: true, stdio: ['ignore', logFd, logFd] },
      );
      child.unref();

      await new Promise((r) => setTimeout(r, 2000));
      execSync('herdr session attach default', { stdio: 'inherit' });
      return; // User attaches — parent exits cleanly
    } catch (e) {
      console.error('Failed to attach:', e);
    }
  }

  pipelineLog(manifest.runId, cwd, `PIPELINE START: ${contractInfo.id} → ${startStage}`);

  // ── State Machine ──
  let currentStage = startStage;
  const maxTransitions = 20;
  let transitionCount = 0;

  while (currentStage !== 'done' && currentStage !== 'blocked' && currentStage !== 'review') {
    transitionCount++;
    if (transitionCount > maxTransitions) {
      pipelineLog(manifest.runId, cwd, `ESCLATED: too many transitions (${transitionCount})`);
      currentStage = 'blocked';
      manifest.currentStage = 'blocked';
      manifest.lastUpdated = new Date().toISOString();
      writeManifest(manifest, cwd);
      await sendReviewUpdate(reviewPaneId, manifest, cwd);
      break;
    }

    pipelineLog(manifest.runId, cwd, `TRANSITION: ${currentStage}`);

    switch (currentStage) {
      // ── Write → Critic (up to 3 loops) ──
      case 'write_contract': {
        const attempt = manifest.loopCount.critic + 1;
        const feedback =
          manifest.loopCount.critic > 0
            ? `\n\n## Critique Feedback (Iteration ${manifest.loopCount.critic}/${MAX_CRITIC_LOOPS})\nPlease address the critical issues from the previous critique.`
            : '';
        await runStage(ctx, 'write_contract', `${attempt}`, feedback);

        if (manifest.stages.write_contract?.verdict?.includes('BLOCKED')) {
          currentStage = 'review';
          transition(ctx, currentStage);
          break;
        }

        // After writer, go to critic
        currentStage = 'critique';
        transition(ctx, currentStage);
        break;
      }

      case 'critique': {
        const attempt = manifest.loopCount.critic + 1;
        const verdict = await runStage(ctx, 'critique', `${attempt}`);

        if (manifest.stages.critique?.verdict?.includes('BLOCKED')) {
          currentStage = 'review';
          transition(ctx, currentStage);
          break;
        }

        const criticVerdict = verdict.critique?.verdict;

        switch (criticVerdict) {
          case 'APPROVE':
            pipelineLog(manifest.runId, cwd, 'Critic: APPROVED → implement');
            currentStage = 'implement';
            transition(ctx, currentStage);
            break;

          case 'CHANGES_REQUESTED':
            manifest.loopCount.critic++;
            if (manifest.loopCount.critic >= MAX_CRITIC_LOOPS) {
              pipelineLog(
                manifest.runId,
                cwd,
                `Critic: CHANGES_REQUESTED but max loops (${MAX_CRITIC_LOOPS}) reached → review`,
              );
              currentStage = 'review';
            } else {
              pipelineLog(
                manifest.runId,
                cwd,
                `Critic: CHANGES_REQUESTED → writer (loop ${manifest.loopCount.critic}/${MAX_CRITIC_LOOPS})`,
              );
              currentStage = 'write_contract';
            }
            transition(ctx, currentStage);
            break;
          default:
            pipelineLog(manifest.runId, cwd, `Critic: ${criticVerdict ?? 'UNKNOWN'} → review`);
            currentStage = 'review';
            transition(ctx, currentStage);
            break;
        }
        break;
      }

      // ── Implement → Verify (up to 3 loops) ──
      case 'implement': {
        const attempt = manifest.loopCount.verify + 1;
        const feedback =
          manifest.loopCount.verify > 0
            ? `\n\n## Verification Feedback (Iteration ${manifest.loopCount.verify}/${MAX_VERIFY_LOOPS})\nPlease address the issues identified in the previous verification.`
            : '';
        await runStage(ctx, 'implement', `${attempt}`, feedback);

        if (manifest.stages.implement?.verdict?.includes('BLOCKED')) {
          currentStage = 'review';
          transition(ctx, currentStage);
          break;
        }

        // Update contract status to implemented (the implementer should do this)
        pipelineLog(manifest.runId, cwd, 'Implementation complete → verify');
        currentStage = 'verify';
        transition(ctx, currentStage);
        break;
      }

      case 'verify': {
        const attempt = manifest.loopCount.verify + 1;
        const verdict = await runStage(ctx, 'verify', `${attempt}`);

        if (manifest.stages.verify?.verdict?.includes('BLOCKED')) {
          currentStage = 'review';
          transition(ctx, currentStage);
          break;
        }

        const verifierVerdict = verdict.verifier?.verdict;

        switch (verifierVerdict) {
          case 'PASS':
            pipelineLog(manifest.runId, cwd, 'Verifier: PASS → review');
            currentStage = 'review';
            transition(ctx, currentStage);
            break;

          case 'CHANGES_REQUESTED':
            manifest.loopCount.verify++;
            if (manifest.loopCount.verify >= MAX_VERIFY_LOOPS) {
              pipelineLog(
                manifest.runId,
                cwd,
                `Verifier: CHANGES_REQUESTED but max loops (${MAX_VERIFY_LOOPS}) reached → review`,
              );
              currentStage = 'review';
            } else {
              pipelineLog(
                manifest.runId,
                cwd,
                `Verifier: CHANGES_REQUESTED → implement (loop ${manifest.loopCount.verify}/${MAX_VERIFY_LOOPS})`,
              );
              currentStage = 'implement';
            }
            transition(ctx, currentStage);
            break;

          default:
            pipelineLog(manifest.runId, cwd, `Verifier: ${verifierVerdict ?? 'UNKNOWN'} → review`);
            currentStage = 'review';
            transition(ctx, currentStage);
            break;
        }
        break;
      }

      default: {
        pipelineLog(manifest.runId, cwd, `Unknown stage: ${currentStage} → done`);
        currentStage = 'done';
        transition(ctx, currentStage);
      }
    }
  }

  // ── Final review stage: send summary to review captain ──
  if (currentStage === 'review') {
    pipelineLog(manifest.runId, cwd, 'Pipeline reached review stage — sending final summary');
    manifest.currentStage = 'review';
    manifest.lastUpdated = new Date().toISOString();
    writeManifest(manifest, cwd);
    await sendFinalSummary(reviewPaneId, manifest, cwd);
  }

  // ── Blocked stage ──
  if (currentStage === 'blocked') {
    pipelineLog(manifest.runId, cwd, 'Pipeline blocked — sending error to review captain');
    const blockedMsg = `## Pipeline Blocked\n\nThe pipeline has been blocked and requires manual intervention.\nSee the pipeline log for details: .pi/contract-runs/${manifest.runId}/pipeline.log`;
    await herdr(['pane', 'send-text', reviewPaneId, blockedMsg]);
    await herdr(['pane', 'send-keys', reviewPaneId, 'Enter']);
  }

  pipelineLog(manifest.runId, cwd, 'PIPELINE COMPLETE');
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║         PIPELINE COMPLETE               ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Contract: ${contractInfo.id.padEnd(32)}║`);
  console.log(`║  Stage: ${currentStage.toString().padEnd(32)}║`);
  console.log(`║  Run: ${manifest.runId.padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════╝');
};

// ── Help ─────────────────────────────────────────────────────

const printHelp = (): void => {
  console.log(
    [
      'Usage: bun run contract <target> [options]',
      '',
      '  target          C-XXX (from TODO.md), path to contract file, or raw description',
      '  --fresh         Regenerate draft and restart (discard previous progress)',
      '  --background    Run detached without joining the Herdr session',
      '  --resume <id>   Resume an interrupted run (run ID from .pi/contract-runs/)',
      '  --help          Show this help',
      '',
      'Examples:',
      '  bun run contract C-312                    # Run contract for TODO.md item C-312',
      '  bun run contract docs/contracts/C-312-restore.md  # Use existing contract',
      '  bun run contract "Add dark mode toggle"   # Create contract from raw description',
      '  bun run contract C-312 --fresh             # Regenerate and restart',
      '  bun run contract C-312 --background        # Run in background',
      '  bun run contract C-312 --resume run-xxx   # Resume interrupted run',
    ].join('\n'),
  );
};

// ── Entry Point ──────────────────────────────────────────────

const main = async (): Promise<void> => {
  const cli = parseArgs();

  if (cli.help || !cli.target) {
    printHelp();
    process.exit(cli.help ? 0 : 1);
  }

  try {
    await runPipeline(cli);
  } catch (error) {
    console.error('❌', error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();
