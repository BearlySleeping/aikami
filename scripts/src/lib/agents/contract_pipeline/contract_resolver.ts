// scripts/src/lib/agents/contract_pipeline/contract_resolver.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { type BacklogItem, parseBacklog } from '../../ops/parse_backlog.ts';

/** Resolved contract metadata. */
export type ContractInfo = {
  id: string;
  title: string;
  path: string;
  status: string;
};

const CONTRACTS_DIR = 'docs/contracts';

const parseContract = (path: string): ContractInfo => {
  const content = readFileSync(path, 'utf-8');
  const identifier = content.match(/^#\s+Contract\s+(C-\d+|MIG-\d+):\s*(.+)/m);
  if (!identifier?.[1]) {
    throw new Error(`Contract heading is invalid: ${path}`);
  }
  const status = content.match(/\|\s*\*\*Status\*\*\s*\|\s*([^|\s]+)\s*\|/);
  return {
    id: identifier[1],
    title: identifier[2]?.trim() ?? basename(path),
    path,
    status: status?.[1]?.trim() ?? 'draft',
  };
};

const contractSlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');

const fillDraft = (options: { repoRoot: string; item: BacklogItem }): string => {
  const contractsDirectory = resolve(options.repoRoot, CONTRACTS_DIR);
  const templatePath = join(contractsDirectory, 'TEMPLATE.md');
  if (!existsSync(templatePath)) {
    throw new Error('docs/contracts/TEMPLATE.md not found.');
  }

  let content = readFileSync(templatePath, 'utf-8')
    .replaceAll('{FEATURE_CODE}', options.item.id)
    .replaceAll('{TITLE}', options.item.title);
  const replaceRow = (label: string, value: string): void => {
    content = content.replace(
      new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|[^\\n]*\\|`),
      `| **${label}** | ${value} |`,
    );
  };
  replaceRow('Source', `TODO.md — ${options.item.phase}`);
  replaceRow('Target', options.item.target || 'TBD');
  replaceRow('Priority', options.item.priority);
  replaceRow('Dependencies', options.item.dependencies || '—');
  replaceRow('Status', 'draft');
  replaceRow('Promotion', '—');
  replaceRow('Docs Impact', 'TBD');
  replaceRow('Contract version', '2.0.0');
  content = content.replace(
    /\{2-4 sentences describing what this task is[^}]*\}/,
    options.item.outcome || options.item.title,
  );
  content = content.replace(
    /\{what is broken or missing today[^}]*\}/,
    `${options.item.title} — see docs/TODO.md for the canonical backlog evidence.`,
  );

  mkdirSync(contractsDirectory, { recursive: true });
  const path = join(
    contractsDirectory,
    `${options.item.id}-${contractSlug(options.item.title)}.md`,
  );
  writeFileSync(path, content);
  return path;
};

/** Resolve an existing path or a canonical backlog ID, generating a shell when required. */
export const resolveContract = (options: { target: string; repoRoot: string }): ContractInfo => {
  if (options.target.endsWith('.md')) {
    const path = resolve(options.repoRoot, options.target);
    if (!existsSync(path)) {
      throw new Error(`Contract file not found: ${options.target}`);
    }
    return parseContract(path);
  }

  const identifier = options.target.toUpperCase();
  if (!/^(C-\d+|MIG-\d+)$/.test(identifier)) {
    throw new Error('Unattended contract runs require a C-XXX, MIG-XXX, or contract path.');
  }

  const contractsDirectory = resolve(options.repoRoot, CONTRACTS_DIR);
  if (existsSync(contractsDirectory)) {
    const existingFile = readdirSync(contractsDirectory).find(
      (file) => file.startsWith(`${identifier}-`) && file.endsWith('.md'),
    );
    if (existingFile) {
      return parseContract(join(contractsDirectory, existingFile));
    }
  }

  const backlog = parseBacklog(options.repoRoot);
  const item = backlog.items.find((candidate) => candidate.id === identifier);
  if (!item) {
    throw new Error(`${identifier} not found in docs/TODO.md.`);
  }

  if (item.existingContractPath && !item.isArchived) {
    return parseContract(resolve(options.repoRoot, item.existingContractPath));
  }
  return parseContract(fillDraft({ repoRoot: options.repoRoot, item }));
};
