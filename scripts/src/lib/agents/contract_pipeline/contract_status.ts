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

/** Atomically update the contract metadata status. */
export const updateContractStatus = (options: { contractPath: string; status: string }): void => {
  const content = readFileSync(options.contractPath, 'utf-8');
  const pattern = /\|\s*\*\*Status\*\*\s*\|\s*[^|\n]+\s*\|/;
  if (!pattern.test(content)) {
    throw new Error(`Contract status row not found: ${options.contractPath}`);
  }
  const updated = content.replace(pattern, `| **Status** | ${options.status} |`);
  const temporaryPath = `${options.contractPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, updated);
  renameSync(temporaryPath, options.contractPath);
};
