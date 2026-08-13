// scripts/src/lib/agents/contract_pipeline/contract_status.ts
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/** Read the contract metadata status. Returns 'draft' when the file does not exist yet. */
export const readContractStatus = (contractPath: string): string => {
  if (!existsSync(contractPath)) {
    return 'draft';
  }
  const content = readFileSync(contractPath, 'utf-8');
  return content.match(/\|\s*\*\*Status\*\*\s*\|\s*([^|\s]+)\s*\|/)?.[1]?.trim() ?? 'draft';
};

/**
 * Pure: returns `content` with its status row replaced. Throws if the row is
 * missing. Split out from {@link updateContractStatus} so callers that commit
 * straight to `main` (see `contract_sync.ts`'s `commitContractContent`) can
 * compute the new content without an intermediate disk write to the root
 * checkout's working tree.
 */
export const withUpdatedStatus = (content: string, status: string): string => {
  const pattern = /\|\s*\*\*Status\*\*\s*\|\s*[^|\n]+\s*\|/;
  if (!pattern.test(content)) {
    throw new Error('Contract status row not found');
  }
  return content.replace(pattern, `| **Status** | ${status} |`);
};

/** Atomically update the contract metadata status on disk. */
export const updateContractStatus = (options: { contractPath: string; status: string }): void => {
  const content = readFileSync(options.contractPath, 'utf-8');
  let updated: string;
  try {
    updated = withUpdatedStatus(content, options.status);
  } catch {
    throw new Error(`Contract status row not found: ${options.contractPath}`);
  }
  const temporaryPath = `${options.contractPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, updated);
  renameSync(temporaryPath, options.contractPath);
};
