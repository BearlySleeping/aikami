#!/usr/bin/env bun
// scripts/src/lib/agents/roadmap_sync.ts
// biome-ignore-all lint/style/useNamingConvention: contract status identifiers and roadmap columns are persisted domain values
//
// Bi-directional sync engine linking three layers:
//   1. docs/TODO.md (local ingestion buffer)
//   2. GitHub Issues + GitHub Projects v2 (macro backlog & roadmap)
//   3. docs/contracts/C-XXX.md (frozen executable contracts)
//
// Sub-commands:
//   bun run sync:roadmap   → all (runs todo + contracts + prs + issues)
//   bun run sync:todo       → TODO.md → GitHub Issues + Project #1
//   bun run sync:contracts  → Local contracts → Roadmap status + close linked issues
//   bun run sync:prs        → Check linked PRs → update contracts/roadmap on merge

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type BacklogItem, parseBacklog } from '../ops/parse_backlog.ts';
import { readContractStatus, updateContractStatus } from './contract_pipeline/contract_status.ts';

// ── Types ──────────────────────────────────────────────────

type ProjectFieldOption = {
  id: string;
  name: string;
};

type ProjectField = {
  id: string;
  name: string;
  options: ProjectFieldOption[];
};

type ProjectMeta = {
  id: string;
  number: number;
  title: string;
  fields: ProjectField[];
};

type IssueRef = {
  number: number;
  url: string;
};

type PrRef = {
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
};

type ContractFile = {
  id: string;
  title: string;
  path: string;
  status: string;
  issueRef: IssueRef | null;
  prRef: PrRef | null;
};

type ProjectItem = {
  id: string;
  contentUrl: string;
  statusName: string;
};

// ── Constants ──────────────────────────────────────────────

const PROJECT_NUMBER = 1;
const DEFAULT_OWNER = 'BearlySleeping';
const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const TODO_PATH = join(REPO_ROOT, 'docs/TODO.md');
const CONTRACTS_DIR = join(REPO_ROOT, 'docs/contracts');

/**
 * Granular lifecycle state → GitHub Project v2 Status column mapping.
 *
 * Uses 5 roadmap states that reflect the contract pipeline phases:
 *   Todo / Backlog  — Not started
 *   Implementing    — Active implementation
 *   Verifying       — Verification / testing in progress
 *   In Review       — PR open, awaiting review
 *   Done            — Completed
 *
 * 🔴 DO NOT hardcode singleSelectOptionId values. Options are resolved
 *    dynamically via GraphQL with fuzzy case-insensitive matching.
 */
const STATUS_TO_PROJECT_COLUMN: Record<string, string> = {
  draft: 'Todo',
  todo: 'Todo',
  approved: 'Todo',
  backlog: 'Backlog',
  implementing: 'Implementing',
  in_progress: 'Implementing',
  implemented: 'Verifying',
  verifying: 'Verifying',
  testing: 'Verifying',
  verification_failed: 'Implementing',
  in_review: 'In Review',
  review: 'In Review',
  verified: 'Done',
  done: 'Done',
  completed: 'Done',
  blocked: 'Todo',
  superseded: 'Done',
};

/** Statuses that auto-close the linked GitHub Issue */
const CLOSE_ON_STATUSES = new Set(['verified', 'done', 'completed', 'superseded']);

/** Remote repo info resolved lazily */
let _repoInfo: { owner: string; repo: string } | null = null;

// ── Helpers ─────────────────────────────────────────────────

const gh = (args: string[], options?: { timeout?: number; cwd?: string }): string => {
  try {
    const result = Bun.spawnSync(['gh', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
      timeout: options?.timeout ?? 30_000,
      cwd: options?.cwd ?? REPO_ROOT,
    });
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    if (result.exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `gh exited with code ${result.exitCode}`);
    }
    return stdout.trim();
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('gh exited')) {
      throw err;
    }
    const msg =
      err instanceof Error ? ((err as { stderr?: string }).stderr ?? err.message) : String(err);
    console.error(`  gh ${args[0]} failed: ${msg}`);
    throw err;
  }
};

const ghJson = <T>(args: string[], options?: { timeout?: number; cwd?: string }): T => {
  const output = gh(args, options);
  return JSON.parse(output) as T;
};

const resolveRepoInfo = (): { owner: string; repo: string } => {
  if (!_repoInfo) {
    try {
      const remote = execSync('git remote get-url origin', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      _repoInfo = {
        owner: match?.[1] ?? DEFAULT_OWNER,
        repo: match?.[2] ?? 'aikami',
      };
    } catch {
      _repoInfo = { owner: DEFAULT_OWNER, repo: 'aikami' };
    }
  }
  return _repoInfo;
};

const resolveOwner = (): string => resolveRepoInfo().owner;

// ── GraphQL Project v2 Operations ───────────────────────────

/**
 * Fetch Project v2 metadata via GraphQL.
 * Returns project node ID, title, and all single-select fields with their options.
 */
const fetchProjectMeta = (options: { owner: string; number: number }): ProjectMeta => {
  // Try organization first (BearlySleeping is an org), fall back to user
  const query = `query($owner: String!, $number: Int!) { organization(login: $owner) { projectV2(number: $number) { id title fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }`;

  const gqlResult = ghJson<{
    data?: {
      organization?: {
        projectV2?: {
          id: string;
          title: string;
          fields: {
            nodes: Array<{
              id: string;
              name: string;
              options: Array<{ id: string; name: string }>;
            }>;
          };
        };
      };
    };
  }>([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `owner=${options.owner}`,
    '-F',
    `number=${options.number}`,
  ]);

  let pv2 = gqlResult.data?.organization?.projectV2;

  // Fall back to user if organization lookup fails
  if (!pv2) {
    const userQuery = `query($owner: String!, $number: Int!) { user(login: $owner) { projectV2(number: $number) { id title fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }`;
    const userResult = ghJson<{
      data?: {
        user?: {
          projectV2?: {
            id: string;
            title: string;
            fields: {
              nodes: Array<{
                id: string;
                name: string;
                options: Array<{ id: string; name: string }>;
              }>;
            };
          };
        };
      };
    }>([
      'api',
      'graphql',
      '-f',
      `query=${userQuery}`,
      '-F',
      `owner=${options.owner}`,
      '-F',
      `number=${options.number}`,
    ]);
    pv2 = userResult.data?.user?.projectV2;
  }
  if (!pv2) {
    throw new Error(`Project v2 #${options.number} not found via GraphQL for @${options.owner}`);
  }

  const fields: ProjectField[] = (pv2.fields?.nodes ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    options: (f.options ?? []).map((o) => ({ id: o.id, name: o.name })),
  }));

  return { id: pv2.id, number: options.number, title: pv2.title, fields };
};

/**
 * Fuzzy-match a target column name to a project field option ID.
 * Uses case-insensitive comparison. Falls back to substring matching.
 */
const fuzzyResolveOptionId = (statusField: ProjectField, columnName: string): string => {
  const target = columnName.toLowerCase().trim();

  // 1. Exact case-insensitive match
  const exact = statusField.options.find((o) => o.name.toLowerCase() === target);
  if (exact) {
    return exact.id;
  }

  // 2. Normalize spaces: "In Progress" ↔ "InProgress" ↔ "In-Progress"
  const normalized = target.replace(/[\s-]+/g, '');
  const normalizedMatch = statusField.options.find(
    (o) => o.name.toLowerCase().replace(/[\s-]+/g, '') === normalized,
  );
  if (normalizedMatch) {
    return normalizedMatch.id;
  }

  // 3. Substring match (e.g. "Implementing" might be "Implementation")
  const substring = statusField.options.find(
    (o) => o.name.toLowerCase().includes(target) || target.includes(o.name.toLowerCase()),
  );
  if (substring) {
    return substring.id;
  }

  const available = statusField.options.map((o) => o.name).join(', ');
  throw new Error(`Status option "${columnName}" not found in project. Available: ${available}`);
};

/** Get the "Status" field from a project's field list.*/
const getStatusField = (project: ProjectMeta): ProjectField => {
  const statusField = project.fields.find((f) => f.name === 'Status');
  if (!statusField) {
    throw new Error(`No "Status" field found in project #${project.number}`);
  }
  return statusField;
};

/** Fetch all project v2 items with content URLs and current status value. */
const fetchProjectItems = (options: { owner: string; number: number }): ProjectItem[] => {
  // Try organization first, fall back to user
  const query = `query($owner: String!, $number: Int!) { organization(login: $owner) { projectV2(number: $number) { items(first: 100) { nodes { id content { ... on Issue { url } ... on PullRequest { url } } fieldValues(first: 5) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } } }`;

  const result = ghJson<{
    data?: {
      organization?: {
        projectV2?: {
          items: {
            nodes: Array<{
              id: string;
              content: { url?: string };
              fieldValues: { nodes: Array<{ name?: string }> };
            }>;
          };
        };
      };
    };
  }>([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `owner=${options.owner}`,
    '-F',
    `number=${options.number}`,
  ]);

  let nodes = result.data?.organization?.projectV2?.items?.nodes;

  if (!nodes) {
    const userQuery = `query($owner: String!, $number: Int!) { user(login: $owner) { projectV2(number: $number) { items(first: 100) { nodes { id content { ... on Issue { url } ... on PullRequest { url } } fieldValues(first: 5) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } } }`;
    const userResult = ghJson<{
      data?: {
        user?: {
          projectV2?: {
            items: {
              nodes: Array<{
                id: string;
                content: { url?: string };
                fieldValues: { nodes: Array<{ name?: string }> };
              }>;
            };
          };
        };
      };
    }>([
      'api',
      'graphql',
      '-f',
      `query=${userQuery}`,
      '-F',
      `owner=${options.owner}`,
      '-F',
      `number=${options.number}`,
    ]);
    nodes = userResult.data?.user?.projectV2?.items?.nodes;
  }
  const finalNodes = nodes ?? [];
  return finalNodes.map((n) => {
    // Get the first single-select value (typically Status if there's only one)
    const name = n.fieldValues?.nodes?.[0]?.name ?? '';
    return {
      id: n.id,
      contentUrl: n.content?.url ?? '',
      statusName: name,
    };
  });
};

/** Mutate a project v2 item's single-select field via GraphQL. */
const setProjectItemStatus = (options: {
  projectId: string;
  itemId: string;
  fieldId: string;
  optionId: string;
}): void => {
  const mutation = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId itemId: $itemId fieldId: $fieldId value: { singleSelectOptionId: $optionId } }) { clientMutationId } }`;

  gh([
    'api',
    'graphql',
    '-f',
    `query=${mutation}`,
    '-f',
    `projectId=${options.projectId}`,
    '-f',
    `itemId=${options.itemId}`,
    '-f',
    `fieldId=${options.fieldId}`,
    '-f',
    `optionId=${options.optionId}`,
  ]);
};

// ── Content Extraction ─────────────────────────────────────

const extractIssueNumber = (url: string): number | null => {
  const match = url.match(/\/issues\/(\d+)/);
  return match ? Number(match[1]) : null;
};

const extractIssueRefFromTodo = (item: BacklogItem): IssueRef | null => {
  const refs = item.references;
  if (!refs) {
    return null;
  }
  const urlMatch = refs.match(/(https:\/\/github\.com\/[^\s]+\/issues\/\d+)/);
  if (urlMatch) {
    return {
      url: urlMatch[1],
      number: extractIssueNumber(urlMatch[1]) ?? 0,
    };
  }
  const numMatch = refs.match(/#(\d+)/);
  if (numMatch) {
    const { owner, repo } = resolveRepoInfo();
    return {
      url: `https://github.com/${owner}/${repo}/issues/${numMatch[1]}`,
      number: Number(numMatch[1]),
    };
  }
  return null;
};

/** Extract issue + PR references from a contract file using YAML frontmatter or markdown table. */
const extractRefsFromContract = (
  content: string,
): { issueRef: IssueRef | null; prRef: PrRef | null } => {
  // Try YAML frontmatter first
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (yamlMatch?.[1]) {
    const yaml = yamlMatch[1];
    let issueRef: IssueRef | null = null;
    let prRef: PrRef | null = null;

    const issueNumMatch = yaml.match(/^\s*issue_number:\s*(\d+)/m);
    const issueUrlMatch = yaml.match(/^\s*issue_url:\s*(.+)/m);
    const prNumMatch = yaml.match(/^\s*pr_number:\s*(\d+)/m);
    const prUrlMatch = yaml.match(/^\s*pr_url:\s*(.+)/m);

    if (issueNumMatch?.[1]) {
      const { owner, repo } = resolveRepoInfo();
      issueRef = {
        number: Number(issueNumMatch[1]),
        url: issueUrlMatch?.[1] ?? `https://github.com/${owner}/${repo}/issues/${issueNumMatch[1]}`,
      };
    }
    if (prNumMatch?.[1]) {
      const { owner, repo } = resolveRepoInfo();
      prRef = {
        number: Number(prNumMatch[1]),
        url: prUrlMatch?.[1] ?? `https://github.com/${owner}/${repo}/pull/${prNumMatch[1]}`,
        state: 'OPEN',
      };
    }
    return { issueRef, prRef };
  }

  // Fall back to markdown table metadata
  const issueMatch = content.match(/\|\s*\*\*GitHub Issue\*\*\s*\|\s*\[?#(\d+)\]\S*\s*\|/);
  const prMatch = content.match(/\|\s*\*\*PR\*\*\s*\|\s*\[?#(\d+)\]\S*\s*\|/);

  const { owner, repo } = resolveRepoInfo();

  return {
    issueRef: issueMatch
      ? {
          number: Number(issueMatch[1]),
          url: `https://github.com/${owner}/${repo}/issues/${issueMatch[1]}`,
        }
      : null,
    prRef: prMatch
      ? {
          number: Number(prMatch[1]),
          url: `https://github.com/${owner}/${repo}/pull/${prMatch[1]}`,
          state: 'OPEN' as const,
        }
      : null,
  };
};

/** Parse all contract files in docs/contracts/. */
const parseAllContracts = (): ContractFile[] => {
  const contracts: ContractFile[] = [];

  if (!existsSync(CONTRACTS_DIR)) {
    return contracts;
  }

  const files = readdirSync(CONTRACTS_DIR).filter(
    (f) => f.startsWith('C-') && f.endsWith('.md') && f !== 'TEMPLATE.md',
  );

  for (const file of files) {
    const path = join(CONTRACTS_DIR, file);
    try {
      const content = readFileSync(path, 'utf-8');
      const idMatch = content.match(/^#\s+Contract\s+(C-\d+|MIG-\d+):\s*(.+)/m);
      if (!idMatch?.[1]) {
        continue;
      }
      const refs = extractRefsFromContract(content);
      contracts.push({
        id: idMatch[1],
        title: (idMatch[2] ?? file).trim(),
        path,
        status: readContractStatus(path),
        issueRef: refs.issueRef,
        prRef: refs.prRef,
      });
    } catch {
      // skip unparseable files
    }
  }

  return contracts;
};

const hasIssueReference = (item: BacklogItem): boolean => {
  return extractIssueRefFromTodo(item) !== null;
};

// ── Sync: TODO → GitHub Issues & Roadmap ────────────────────

/**
 * Sync un-synced TODO.md items to GitHub Issues and link them to the roadmap project.
 */
const syncTodoItems = (options: {
  owner: string;
  dryRun?: boolean;
}): { created: number; linked: number; errors: string[] } => {
  const errors: string[] = [];
  let created = 0;
  let linked = 0;

  console.log(`\n📋  Scanning docs/TODO.md for un-synced items...\n`);

  const backlog = parseBacklog(REPO_ROOT);
  const pendingItems = backlog.items.filter(
    (item) => item.status !== 'completed' && !hasIssueReference(item),
  );

  if (pendingItems.length === 0) {
    console.log('   ✅ All TODO items already have issue references.\n');
    return { created: 0, linked: 0, errors: [] };
  }

  console.log(`   Found ${pendingItems.length} un-synced items:\n`);

  for (const item of pendingItems) {
    const label = `${item.id}: ${item.title}`;
    console.log(`   🔄  ${label}`);

    if (options.dryRun) {
      console.log('       [DRY RUN] Would create issue and link to project #1');
      created++;
      linked++;
      continue;
    }

    try {
      const body = [
        `> Auto-generated from \`docs/TODO.md\` — **${item.id}**`,
        '',
        `**Phase:** ${item.phase || 'N/A'}`,
        `**Priority:** ${item.priority}`,
        `**Target:** ${item.target || 'N/A'}`,
        `**Status:** ${item.status}`,
        '',
        '## Outcome',
        item.outcome || 'N/A',
        '',
        '## Scope',
        item.scope || 'N/A',
        '',
        '## Acceptance Gate',
        item.acceptanceGate || 'N/A',
        '',
        item.dependencies ? `**Dependencies:** ${item.dependencies}` : '',
        '',
        '---',
        `*Source: [docs/TODO.md](${TODO_PATH})*`,
      ]
        .filter(Boolean)
        .join('\n');

      const labels = [`priority:${item.priority.toLowerCase()}`, 'from-todo'];

      const issueArgs = ['issue', 'create', '--title', label, '--body', body];
      for (const l of labels) {
        issueArgs.push('--label', l);
      }
      const issueOutput = gh(issueArgs);
      const issueUrl = issueOutput.match(/(https:\/\/github\.com\/[^\s]+)/)?.[1] ?? '';
      const issueNum = extractIssueNumber(issueUrl);

      if (!issueUrl || !issueNum) {
        errors.push(`Failed to extract issue URL from: ${issueOutput}`);
        continue;
      }

      console.log(`       ✅ Issue created: ${issueUrl}`);
      created++;

      try {
        gh([
          'project',
          'item-add',
          String(PROJECT_NUMBER),
          '--owner',
          options.owner,
          '--url',
          issueUrl,
        ]);
        console.log(`       📌 Linked to Project #${PROJECT_NUMBER}`);
        linked++;
      } catch {
        errors.push(`Failed to link ${issueUrl} to project #${PROJECT_NUMBER}`);
      }

      backfillTodoReference({ item, issueUrl, issueNum });
      console.log(`       📝 Backfilled TODO.md with #${issueNum}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to sync ${label}: ${msg}`);
      console.error(`       ❌ Failed: ${msg}`);
    }
  }

  return { created, linked, errors };
};

/** Backfill a TODO.md item with its GitHub Issue reference. */
const backfillTodoReference = (options: {
  item: BacklogItem;
  issueUrl: string;
  issueNum: number;
}): void => {
  const content = readFileSync(TODO_PATH, 'utf-8');
  const { item, issueUrl, issueNum } = options;

  const sectionMatch = content.match(new RegExp(`(${escapeRegex(`### ${item.id}`)}[^#]*)`, 'm'));

  if (!sectionMatch?.[1]) {
    throw new Error(`Could not extract section for ${item.id}`);
  }

  const section = sectionMatch[1];
  const lines = section.split('\n');
  let lastBulletIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.match(/^-\s+\*\*.*\*\*:/)) {
      lastBulletIdx = i;
    }
  }

  if (lastBulletIdx === -1) {
    throw new Error(`Could not find bullet fields in section for ${item.id}`);
  }

  const newBullet = `- **References:** [Issue #${issueNum}](${issueUrl})`;
  lines.splice(lastBulletIdx + 1, 0, newBullet);
  const updatedSection = lines.join('\n');
  const updatedContent = content.replace(section, updatedSection);
  writeFileSync(TODO_PATH, updatedContent);
};

// ── Sync: Local Contracts → Roadmap Status ──────────────────

/**
 * Sync local contract statuses to the GitHub Project v2 roadmap.
 * Uses fuzzy GraphQL option resolution for column names.
 */
const syncContractsToRoadmap = (options: {
  owner: string;
  dryRun?: boolean;
}): { updated: number; closed: number; errors: string[] } => {
  const errors: string[] = [];
  let updated = 0;
  let closed = 0;

  console.log(`\n📋  Reading contracts from docs/contracts/...\n`);

  const contracts = parseAllContracts();

  if (contracts.length === 0) {
    console.log('   No contracts found.\n');
    return { updated: 0, closed: 0, errors: [] };
  }

  console.log(`   Found ${contracts.length} contracts. Fetching project metadata...\n`);

  let project: ProjectMeta;
  let projectItems: ProjectItem[];
  try {
    project = fetchProjectMeta({ owner: options.owner, number: PROJECT_NUMBER });
    projectItems = fetchProjectItems({ owner: options.owner, number: PROJECT_NUMBER });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { updated: 0, closed: 0, errors: [`Failed to fetch project data: ${msg}`] };
  }

  const statusField = getStatusField(project);

  // Log available status options for debugging
  console.log(
    `   Available status options: ${statusField.options.map((o) => o.name).join(', ')}\n`,
  );

  // Build lookup: content URL → project item
  const itemByUrl = new Map<string, ProjectItem>();
  for (const pi of projectItems) {
    if (pi.contentUrl) {
      itemByUrl.set(pi.contentUrl, {
        id: pi.id,
        contentUrl: pi.contentUrl,
        statusName: pi.statusName,
      });
    }
  }

  for (const contract of contracts) {
    const targetColumn = STATUS_TO_PROJECT_COLUMN[contract.status];
    if (!targetColumn) {
      continue;
    }

    // Also consider PR-based status: if contract has an open PR, it's "In Review"
    const effectiveColumn =
      contract.prRef && contract.prRef.state === 'OPEN' ? 'In Review' : targetColumn;

    // Use issue URL first, fall back to PR URL
    const linkedUrl = contract.issueRef?.url ?? contract.prRef?.url;
    if (!linkedUrl) {
      continue;
    }

    const projectItem = itemByUrl.get(linkedUrl);

    if (!projectItem) {
      console.log(
        `   ⚠️  ${contract.id}: Linked content not found in Project #${PROJECT_NUMBER} (${linkedUrl})`,
      );
      continue;
    }

    const currentColumn = projectItem.statusName;

    if (currentColumn === effectiveColumn) {
      continue;
    }

    const label = `${contract.id}: ${contract.status} → "${effectiveColumn}"`;
    console.log(`   🔄  ${label} (was "${currentColumn}")`);

    if (options.dryRun) {
      console.log('       [DRY RUN] Would update status and close if applicable');
      updated++;
      if (CLOSE_ON_STATUSES.has(contract.status)) {
        closed++;
      }
      continue;
    }

    try {
      const optionId = fuzzyResolveOptionId(statusField, effectiveColumn);
      setProjectItemStatus({
        projectId: project.id,
        itemId: projectItem.id,
        fieldId: statusField.id,
        optionId,
      });
      console.log(`       ✅ Status updated`);
      updated++;

      if (CLOSE_ON_STATUSES.has(contract.status) && contract.issueRef) {
        try {
          gh(['issue', 'close', String(contract.issueRef.number), '--reason', 'completed']);
          console.log(`       🎉 Issue #${contract.issueRef.number} closed`);
          closed++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to close issue #${contract.issueRef.number}: ${msg}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to update ${contract.id}: ${msg}`);
      console.error(`       ❌ Failed: ${msg}`);
    }
  }

  return { updated, closed, errors };
};

// ── Sync: PRs → Contract Status ─────────────────────────────

/**
 * Check linked PRs and update contract status + roadmap when PRs are merged.
 * - When a linked PR is merged → update contract status to verified/done
 * - When a linked PR is merged → move roadmap item to Done
 * - When a linked PR is merged → close the linked issue
 */
const syncPrsToContracts = (options: {
  owner: string;
  dryRun?: boolean;
}): { merged: number; updated: number; errors: string[] } => {
  const errors: string[] = [];
  let merged = 0;
  let updated = 0;

  console.log(`\n📋  Checking linked PRs for merged status...\n`);

  const contracts = parseAllContracts();
  const contractsWithPrs = contracts.filter((c) => c.prRef !== null);

  if (contractsWithPrs.length === 0) {
    console.log('   No contracts with linked PRs found.\n');
    return { merged: 0, updated: 0, errors: [] };
  }

  console.log(`   Found ${contractsWithPrs.length} contracts with linked PRs.\n`);

  // Fetch project data for roadmap updates
  let project: ProjectMeta | null = null;
  let projectItems: ProjectItem[] = [];
  try {
    project = fetchProjectMeta({ owner: options.owner, number: PROJECT_NUMBER });
    projectItems = fetchProjectItems({ owner: options.owner, number: PROJECT_NUMBER });
  } catch {
    console.log('   ⚠️  Could not fetch project data; skipping roadmap updates.\n');
  }

  const statusField = project ? getStatusField(project) : null;
  const itemByUrl = new Map<string, ProjectItem>();
  for (const pi of projectItems) {
    if (pi.contentUrl) {
      itemByUrl.set(pi.contentUrl, pi);
    }
  }

  for (const contract of contractsWithPrs) {
    if (!contract.prRef) {
      continue;
    }

    console.log(`   🔍  ${contract.id}: PR #${contract.prRef.number} (${contract.prRef.url})`);

    // Fetch current PR state
    let prState: 'OPEN' | 'CLOSED' | 'MERGED';
    try {
      const prJson = ghJson<{ state: string; mergedAt: string | null }>([
        'pr',
        'view',
        String(contract.prRef.number),
        '--json',
        'state,mergedAt',
      ]);
      prState = prJson.mergedAt ? 'MERGED' : prJson.state === 'CLOSED' ? 'CLOSED' : 'OPEN';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to check PR #${contract.prRef.number}: ${msg}`);
      continue;
    }

    console.log(`       State: ${prState}`);

    if (prState === 'MERGED' && contract.status !== 'verified' && contract.status !== 'done') {
      console.log(`       🎉 PR merged! Updating contract status...`);

      if (options.dryRun) {
        console.log(
          `       [DRY RUN] Would update ${contract.id} to verified, close issue, move to Done`,
        );
        merged++;
        updated++;
        continue;
      }

      // Update contract status
      try {
        updateContractStatus({ contractPath: contract.path, status: 'verified' });
        console.log(`       ✅ Contract ${contract.id} → verified`);
        updated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to update ${contract.id} status: ${msg}`);
        continue;
      }

      // Close linked issue
      if (contract.issueRef) {
        try {
          gh(['issue', 'close', String(contract.issueRef.number), '--reason', 'completed']);
          console.log(`       🎉 Issue #${contract.issueRef.number} closed`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to close issue #${contract.issueRef.number}: ${msg}`);
        }
      }

      // Move roadmap item to Done
      if (statusField) {
        const projectItem = contract.issueRef
          ? itemByUrl.get(contract.issueRef.url)
          : itemByUrl.get(contract.prRef.url);

        if (projectItem && project) {
          try {
            const doneOptionId = fuzzyResolveOptionId(statusField, 'Done');
            setProjectItemStatus({
              projectId: project.id,
              itemId: projectItem.id,
              fieldId: statusField.id,
              optionId: doneOptionId,
            });
            console.log('       📌 Roadmap item → Done');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Failed to update roadmap: ${msg}`);
          }
        }
      }

      merged++;
    }
  }

  return { merged, updated, errors };
};

// ── Sync: New GitHub Issues → Project #1 Association ────────

const syncIssuesToProject = (options: {
  owner: string;
  dryRun?: boolean;
}): { linked: number; errors: string[] } => {
  const errors: string[] = [];

  console.log(`\n📋  Checking for unlinked GitHub Issues...\n`);

  let projectItems: Array<{ contentUrl: string }>;
  try {
    projectItems = fetchProjectItems({ owner: options.owner, number: PROJECT_NUMBER });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { linked: 0, errors: [`Failed to fetch project items: ${msg}`] };
  }

  const projectUrls = new Set(projectItems.map((pi) => pi.contentUrl).filter(Boolean));

  let issuesJson: Array<{ number: number; url: string; title: string }>;
  try {
    issuesJson = ghJson<Array<{ number: number; url: string; title: string }>>([
      'issue',
      'list',
      '--state',
      'open',
      '--json',
      'number,url,title',
      '--limit',
      '100',
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { linked: 0, errors: [`Failed to fetch issues: ${msg}`] };
  }

  const unlinked = issuesJson.filter((issue) => !projectUrls.has(issue.url));

  if (unlinked.length === 0) {
    console.log('   ✅ All open issues are already linked to the project.\n');
    return { linked: 0, errors: [] };
  }

  console.log(`   Found ${unlinked.length} unlinked issues.\n`);
  let linked = 0;

  for (const issue of unlinked) {
    console.log(`   🔗  #${issue.number}: ${issue.title}`);

    if (options.dryRun) {
      console.log('       [DRY RUN] Would link to project #1');
      linked++;
      continue;
    }

    try {
      gh([
        'project',
        'item-add',
        String(PROJECT_NUMBER),
        '--owner',
        options.owner,
        '--url',
        issue.url,
      ]);
      console.log(`       ✅ Linked to Project #${PROJECT_NUMBER}`);
      linked++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to link #${issue.number}: ${msg}`);
      console.error(`       ❌ Failed: ${msg}`);
    }
  }

  return { linked, errors };
};

// ── CLI Entry Point ─────────────────────────────────────────

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const printUsage = (): void => {
  console.log(
    [
      'Usage:',
      '  bun run sync:roadmap              # Run all sync tasks (todo + contracts + prs + issues)',
      '  bun run sync:todo                 # Sync TODO.md → GitHub Issues + Project',
      '  bun run sync:contracts            # Sync local contracts → Project status',
      '  bun run sync:prs                  # Check linked PRs → update on merge',
      '  bun run roadmap_sync.ts all       # Same as sync:roadmap',
      '  bun run roadmap_sync.ts todo      # Same as sync:todo',
      '  bun run roadmap_sync.ts contracts # Same as sync:contracts',
      '  bun run roadmap_sync.ts prs       # Same as sync:prs',
      '  bun run roadmap_sync.ts issues    # Link unassociated issues to project',
      '',
      'Options:',
      '  --dry-run   Preview changes without mutating anything',
      '  --owner     GitHub org/user (default: from remote or BearlySleeping)',
      '',
    ].join('\n'),
  );
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const subCommand = args.find((a) => !a.startsWith('--')) ?? 'all';
  const dryRun = args.includes('--dry-run');
  const ownerIdx = args.indexOf('--owner');
  const ownerArg = ownerIdx !== -1 && ownerIdx + 1 < args.length ? args[ownerIdx + 1] : undefined;
  const owner = ownerArg ?? resolveOwner();

  const validCommands = new Set(['all', 'todo', 'contracts', 'contract', 'prs', 'issues']);
  if (!validCommands.has(subCommand)) {
    console.error(`Unknown sub-command: ${subCommand}\n`);
    printUsage();
    process.exit(1);
  }

  console.log(
    [
      '═══════════════════════════════════════════',
      '  Aikami Roadmap Sync Engine',
      `  Owner: @${owner}`,
      `  Project: #${PROJECT_NUMBER}`,
      dryRun ? '  Mode: DRY RUN (no mutations)' : '',
      '═══════════════════════════════════════════',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const allErrors: string[] = [];

  if (subCommand === 'all' || subCommand === 'todo') {
    const result = syncTodoItems({ owner, dryRun });
    allErrors.push(...result.errors);
  }

  if (subCommand === 'all' || subCommand === 'contracts' || subCommand === 'contract') {
    const result = syncContractsToRoadmap({ owner, dryRun });
    allErrors.push(...result.errors);
  }

  if (subCommand === 'all' || subCommand === 'prs') {
    const result = syncPrsToContracts({ owner, dryRun });
    allErrors.push(...result.errors);
  }

  if (subCommand === 'all' || subCommand === 'issues') {
    const result = syncIssuesToProject({ owner, dryRun });
    allErrors.push(...result.errors);
  }

  console.log('\n═══════════════════════════════════════════');
  if (allErrors.length > 0) {
    console.log(`⚠️  Completed with ${allErrors.length} error(s):`);
    for (const err of allErrors) {
      console.log(`   - ${err}`);
    }
    process.exit(1);
  } else {
    console.log('✅ Sync complete.');
  }
  console.log('═══════════════════════════════════════════\n');
}
