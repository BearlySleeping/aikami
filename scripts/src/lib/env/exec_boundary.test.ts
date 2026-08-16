// scripts/src/lib/env/exec_boundary.test.ts
//
// 🔴 THE execSync QUOTING BOUNDARY — the whole point of this file.
//
// `execSync` shells out through cmd.exe on Windows. A single quote there is
// a literal character, not quoting — hand-writing POSIX `'${value}'`
// wrapping around an interpolated value (or around any literal argument)
// does not protect it; it just inserts two stray quote characters into the
// argument cmd.exe actually receives. This is exactly how the contract
// pipeline's PR lookup broke on Windows: `gh pr list --head '${headBranch}'
// ... --jq '.[0].url'` ran as-is, `gh` and `jq` choked on the literal `'`
// characters, and the failure was swallowed by a `catch { return undefined
// }` — the orchestrator concluded "No PR found" instead of reporting the
// real cause (see docs/contracts and the rig-audit findings, F-02).
//
// `execFileSync(bin, argv)` bypasses the shell entirely, so there is
// nothing to quote and nothing platform-specific to get wrong — it is the
// correct replacement everywhere in this list. `runGit()` in
// agents/git_worktree.ts is a deliberate, audited exception: it tokenizes
// the command string itself (see splitGitCommand) and calls
// execFileSync — never a real shell — so single quotes there are consumed
// by that tokenizer, not leaked to cmd.exe.
//
// Scope: the herdr / contract-pipeline layer only — the files where this
// bug actually breaks the automated pipeline. Other scripts under
// scripts/src/lib/ops and scripts/src/lib/deploy also call `execSync` with
// interpolated template literals; several are POSIX-only tools already
// (e.g. `find -printf`) with their own, separate portability gaps that are
// out of scope for this guard. Widen SCAN_ROOTS below if those are ever
// brought onto the same Windows-compatibility bar.

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../../../..');

const SCAN_ROOTS = [
  'scripts/src/lib/herdr',
  'scripts/src/lib/agents/contract_pipeline',
  'scripts/src/lib/agents/contract_pipeline.ts',
  'scripts/src/lib/agents/git_worktree.ts',
].map((p) => join(repoRoot, p));

/** All non-test .ts files under a root (file or directory), recursively. */
const collectFiles = (root: string): string[] => {
  const stat = statSync(root);
  if (stat.isFile()) {
    return root.endsWith('.ts') && !root.endsWith('.test.ts') ? [root] : [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (extname(entry.name) === '.ts' && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Extract the raw text of every backtick template literal passed as the
 * first argument to a call named `execSync(`. Not a full JS parser — this
 * repo's execSync call sites are simple enough that a brace-depth scan over
 * the template is sufficient, and a guard test failing loudly on a
 * genuinely too-complex template is an acceptable edge (rewrite the call to
 * execFileSync instead of teaching the scanner more syntax).
 */
const execSyncTemplateArgs = (source: string): string[] => {
  const templates: string[] = [];
  const callPattern = /\bexecSync\(\s*`/g;
  let match: RegExpExecArray | null = callPattern.exec(source);
  while (match !== null) {
    const start = match.index + match[0].length;
    let i = start;
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        depth += 1;
        i += 2;
        continue;
      }
      if (depth > 0 && ch === '}') {
        depth -= 1;
        i += 1;
        continue;
      }
      if (depth === 0 && ch === '`') {
        break;
      }
      i += 1;
    }
    templates.push(source.slice(start, i));
    match = callPattern.exec(source);
  }
  return templates;
};

/**
 * True when a template's literal text (i.e. excluding `${...}`
 * interpolations) contains a single quote — the hand-POSIX-quoting pattern
 * that only ever worked on a POSIX shell and leaks through cmd.exe on
 * Windows.
 */
const hasStrayPosixQuote = (template: string): boolean => {
  const withoutInterpolations = template.replace(/\$\{[^{}]*\}/g, '');
  return withoutInterpolations.includes("'");
};

const filesToScan = SCAN_ROOTS.flatMap(collectFiles);

describe('execSync calls in the herdr / contract-pipeline layer never hand-POSIX-quote', () => {
  it('finds the files to check', () => {
    // Guards the guard: a bad SCAN_ROOTS entry would make every case below
    // vacuously pass.
    expect(filesToScan.length).toBeGreaterThan(10);
  });

  for (const file of filesToScan) {
    it(relative(repoRoot, file), () => {
      const source = readFileSync(file, 'utf8');
      const offenders = execSyncTemplateArgs(source).filter(hasStrayPosixQuote);
      expect(offenders).toEqual([]);
    });
  }
});

describe('execSyncTemplateArgs / hasStrayPosixQuote', () => {
  it('detects the real bug shape but ignores interpolation-internal quotes', () => {
    // Proves the detector actually fires — otherwise the suite above could
    // pass simply because the regex never matches anything. These fixtures
    // are SOURCE-CODE SNAPSHOTS: they must stay literal text, so they are
    // template literals with escaped backticks (\`) and escaped
    // interpolations (\${) — the values are byte-identical to the plain
    // strings they replaced, but lint-clean (noTemplateCurlyInString).
    const broken = `execSync(\`gh pr list --head '\${headBranch}' --jq '.[0].url'\`, opts)`;
    expect(execSyncTemplateArgs(broken).some(hasStrayPosixQuote)).toBe(true);

    // A `'` used only inside a `${...}` JS expression (e.g. Array#join's
    // separator) is not shell-quoting at all — must not false-positive.
    const fine = `execSync(\`docker \${args.join(' ')}\`, opts)`;
    expect(execSyncTemplateArgs(fine).some(hasStrayPosixQuote)).toBe(false);

    // Plain interpolation with no quoting anywhere — must not false-positive.
    const alsoFine = `execSync(\`git \${command}\`, opts)`;
    expect(execSyncTemplateArgs(alsoFine).some(hasStrayPosixQuote)).toBe(false);
  });
});
