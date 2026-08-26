// scripts/src/lib/agents/contract_pipeline/contract_status.ts
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Extracts the metadata-table status from contract markdown. Pure — split out
 * so a caller holding content from somewhere other than disk (e.g. `git show
 * main:path`, see `contract_sync.ts`'s `readMainContent`) can parse it without
 * a round-trip through the filesystem.
 */
export const parseContractStatus = (content: string): string =>
  content.match(/\|\s*\*\*Status\*\*\s*\|\s*([^|\s]+)\s*\|/)?.[1]?.trim() ?? 'draft';

/** Read the contract metadata status. Returns 'draft' when the file does not exist yet. */
export const readContractStatus = (contractPath: string): string => {
  if (!existsSync(contractPath)) {
    return 'draft';
  }
  return parseContractStatus(readFileSync(contractPath, 'utf-8'));
};

/**
 * Pure: returns `content` with its status row replaced. Throws if the row is
 * missing. Split out from {@link updateContractStatus} so callers that commit
 * straight to `main` (see `contract_sync.ts`'s `commitContractContent`) can
 * compute the new content without an intermediate disk write to the root
 * checkout's working tree.
 *
 * Also updates the YAML frontmatter `status:` field when present, so the two
 * status sources ({@link readContractStatus}'s metadata table and
 * `contract_resolver.ts`'s frontmatter read) never drift apart the way C-391
 * did — approved via the table while its frontmatter still said `draft`.
 */
export const withUpdatedStatus = (content: string, status: string): string => {
  const tablePattern = /\|\s*\*\*Status\*\*\s*\|\s*[^|\n]+\s*\|/;
  if (!tablePattern.test(content)) {
    throw new Error('Contract status row not found');
  }
  let updated = content.replace(tablePattern, `| **Status** | ${status} |`);

  const frontmatterMatch = updated.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontmatterMatch) {
    const statusLinePattern = /^status:\s*\S+\s*$/m;
    if (statusLinePattern.test(frontmatterMatch[1])) {
      const updatedFrontmatter = frontmatterMatch[1].replace(
        statusLinePattern,
        `status: ${status}`,
      );
      // `index` is undefined only when the match is zero-length at position
      // 0, which the leading `^---\n` pattern makes impossible — but the
      // type system can't see that, so guard instead of asserting.
      if (frontmatterMatch.index === undefined) {
        return updated;
      }
      updated =
        updated.slice(0, frontmatterMatch.index) +
        `---\n${updatedFrontmatter}\n---\n` +
        updated.slice(frontmatterMatch.index + frontmatterMatch[0].length);
    }
  }

  return updated;
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
