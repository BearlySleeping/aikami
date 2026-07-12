// scripts/src/lib/agents/contract_pipeline/contract_resolver.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseBacklog } from '../../ops/parse_backlog.ts';

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

/** Compute the expected contract filename from a TODO ID and title — never writes to disk. */
const expectedContractPath = (options: { repoRoot: string; id: string; title: string }): string =>
  join(resolve(options.repoRoot, CONTRACTS_DIR), `${options.id}-${contractSlug(options.title)}.md`);

/** Resolve an existing path or a canonical backlog ID. */
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

  // Contract does not exist on disk yet — the writer Pi session will create it
  // via contract_generate. Return the expected path without writing to disk.
  return {
    id: item.id,
    title: item.title,
    path: expectedContractPath({ repoRoot: options.repoRoot, id: item.id, title: item.title }),
    status: 'draft',
  };
};
