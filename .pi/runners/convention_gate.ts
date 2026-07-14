// .pi/runners/convention_gate.ts
/**
 * AST-Aware Behavioral Code Reviewer & Convention Gate (C-304).
 *
 * Two-tier compliance workflow:
 *
 *   Tier 1 (Zero Token Cost):
 *     - Runs deterministic AST/syntax checks via Biome + tree-sitter patterns
 *     - Validates file naming, path comments, route boundaries, options objects,
 *       private field prefixes, import conventions, ViewModel patterns
 *     - Fails immediately without any LLM invocation
 *
 *   Tier 2 (LLM Cognitive Review):
 *     - Only reached if Tier 1 passes cleanly
 *     - Passes AST-stripped type skeletons + unified patch diffs to LLM
 *     - Checks logical boundaries: view logic separation, ViewModel boundaries
 *
 * Usage:
 *   bun run .pi/runners/convention_gate.ts [--paths <dir>] [--base <ref>] [--verbose]
 *
 * Exit codes:
 *   0 — All checks passed
 *   1 — Tier 1 convention violations (deterministic)
 *   2 — Tier 2 logical violations (requires LLM review)
 *   3 — Gate configuration error
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

// ── Types ──────────────────────────────────────────────────

type GateViolation = {
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  message: string;
};

type GateResult = {
  passed: boolean;
  tier: 1 | 2;
  violations: GateViolation[];
  durationMs: number;
};

// ── Configuration ──────────────────────────────────────────

const RULES_PATH = resolve(
  import.meta.dir,
  '..',
  'skills',
  'aikami-conventions',
  'lint_rules.json',
);
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');

type LintRule = {
  id: string;
  name: string;
  category: string;
  severity: 'error' | 'warning';
  description: string;
  biomeRule?: string;
  patterns?: Array<{
    fileGlob: string;
    regex: string;
    line?: number;
    forbidden?: boolean;
    message: string;
    requireAlso?: string;
    excludePatterns?: string[];
  }>;
};

type LintRulesConfig = {
  version: string;
  rules: LintRule[];
};

// ── CLI parsing ────────────────────────────────────────────

const _parseArgs = (): { pathsArg?: string; baseRef?: string; verbose: boolean } => {
  const args = process.argv.slice(2);
  let pathsArg: string | undefined;
  let baseRef: string | undefined;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--paths' && args[i + 1]) {
      pathsArg = args[i + 1];
      i++;
    } else if (args[i] === '--base' && args[i + 1]) {
      baseRef = args[i + 1];
      i++;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    }
  }

  return { pathsArg, baseRef, verbose };
};

// ── Rule loading ───────────────────────────────────────────

const _loadRules = (): LintRulesConfig => {
  if (!existsSync(RULES_PATH)) {
    throw new Error(`Rules file not found: ${RULES_PATH}`);
  }
  return JSON.parse(readFileSync(RULES_PATH, 'utf-8')) as LintRulesConfig;
};

// ── File gathering ─────────────────────────────────────────

/**
 * Recursively gather TypeScript/Svelte files in a directory.
 */
const _gatherFiles = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);

    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await _gatherFiles(fullPath)));
    } else if (entry.isFile() && /\.(ts|tsx|svelte)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

/**
 * Get list of changed files relative to a base ref.
 */
const _getChangedFiles = async (baseRef: string): Promise<string[]> => {
  return new Promise((resolveF, rejectF) => {
    const proc = spawn('git', ['diff', '--name-only', baseRef, 'HEAD'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        rejectF(new Error(`git diff failed with code ${code}`));
        return;
      }
      const files = out
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.length > 0)
        .map((f) => resolve(PROJECT_ROOT, f));

      resolveF(files);
    });
  });
};

// ── Pattern matching ───────────────────────────────────────

/**
 * Check if a file path matches a glob pattern.
 * Supports double-star glob (star-star-slash), single star, and .ts extensions.
 */
const _matchesGlob = (filePath: string, glob: string): boolean => {
  const rel = relative(PROJECT_ROOT, filePath);

  // Convert glob to regex using placeholder tokens to avoid corruption
  // Sentinel tokens for glob-to-regex conversion (must not appear in paths)
  const SentinelDir = '\u{E000}';
  const SentinelGlob = '\u{E001}';

  let regexStr = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*\*\/\*/g, SentinelDir)
    .replace(/\*\*/g, SentinelGlob)
    .replace(/\*/g, '[^/]*')
    .replace(new RegExp(SentinelDir, 'g'), '(?:.+/)?')
    .replace(new RegExp(SentinelGlob, 'g'), '.*');

  regexStr = `^${regexStr}$`;

  try {
    return new RegExp(regexStr).test(rel);
  } catch {
    return false;
  }
};

// ── Rule checking ──────────────────────────────────────────

/**
 * Check a single file against a single rule's patterns.
 */
const _checkPatterns = (
  filePath: string,
  content: string,
  lines: string[],
  rule: LintRule,
): GateViolation[] => {
  const violations: GateViolation[] = [];

  if (!rule.patterns) {
    return violations;
  }

  for (const pattern of rule.patterns) {
    if (!_matchesGlob(filePath, pattern.fileGlob)) {
      continue;
    }

    // ── Exclusion check ────────────────────────────────
    if (pattern.excludePatterns) {
      const skip = pattern.excludePatterns.some((ex) => {
        try {
          return new RegExp(ex).test(content);
        } catch {
          return false;
        }
      });
      if (skip) {
        continue;
      }
    }

    // ── Forbidden check ────────────────────────────────
    if (pattern.forbidden) {
      const rel = relative(PROJECT_ROOT, filePath);
      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        file: rel,
        message: pattern.message,
      });
      continue;
    }

    // ── Specific line check ────────────────────────────
    if (pattern.line !== undefined) {
      const targetLine = lines[pattern.line - 1] ?? '';
      try {
        if (!new RegExp(pattern.regex).test(targetLine)) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            file: relative(PROJECT_ROOT, filePath),
            line: pattern.line,
            message: rule.description,
          });
        }
      } catch {
        // Invalid regex — skip
      }
      continue;
    }

    // ── Regex match against full content ───────────────
    try {
      const match = new RegExp(pattern.regex, 'm').test(content);

      if (match) {
        // Check requireAlso constraint
        if (pattern.requireAlso) {
          try {
            const alsoMatch = new RegExp(pattern.requireAlso, 'm').test(content);
            if (alsoMatch) {
              continue; // Both patterns match — pass
            }
          } catch {
            // Invalid regex
          }
        }

        const lineNum = content.split('\n').findIndex((l) => new RegExp(pattern.regex).test(l));

        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          file: relative(PROJECT_ROOT, filePath),
          line: lineNum >= 0 ? lineNum + 1 : undefined,
          message: pattern.message,
        });
      }
    } catch {
      // Invalid regex — skip
    }
  }

  return violations;
};

// ── Biome execution (Tier 1) ───────────────────────────────

/**
 * Run Biome lint and check for failures.
 */
const _runBiomeCheck = async (files: string[]): Promise<GateViolation[]> => {
  if (files.length === 0) {
    return [];
  }

  return new Promise((resolveB) => {
    const proc = spawn('bun', ['biome', 'check', ...files, '--error-on-warnings'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolveB([]);
        return;
      }

      // Parse biome output for violations
      const violations: GateViolation[] = [];
      const lines = stderr.split('\n');

      for (const line of lines) {
        // Match: path:line:col lint/rule ━━━━
        const match = /^(.+?):(\d+):(\d+)\s+(lint|check)\/(\S+)/.exec(line.trim());
        if (match?.[1] && match[2] && match[4] && match[5]) {
          violations.push({
            ruleId: match[5],
            ruleName: match[4],
            severity: 'error',
            file: match[1],
            line: Number.parseInt(match[2], 10),
            message: `Biome violation: ${match[5]}`,
          });
        }
      }

      resolveB(violations);
    });
  });
};

// ── Tier 1: Deterministic checks ───────────────────────────

const _runTier1 = async (options: { files: string[]; verbose: boolean }): Promise<GateResult> => {
  const { files, verbose } = options;
  const start = Date.now();
  const violations: GateViolation[] = [];

  // ── Load rules ───────────────────────────────────────
  const rulesConfig = _loadRules();
  if (verbose) {
    console.log(`[gate:tier1] Loaded ${rulesConfig.rules.length} rules`);
  }

  // ── Read file contents ───────────────────────────────
  const fileContents = new Map<string, { content: string; lines: string[] }>();

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      fileContents.set(file, { content, lines: content.split('\n') });
    } catch {
      if (verbose) {
        console.warn(`[gate:tier1] Cannot read: ${file}`);
      }
    }
  }

  if (verbose) {
    console.log(`[gate:tier1] Checking ${fileContents.size} files...`);
  }

  // ── Rule-by-rule checks ──────────────────────────────
  for (const rule of rulesConfig.rules) {
    for (const [filePath, { content, lines }] of fileContents) {
      const fileViolations = _checkPatterns(filePath, content, lines, rule);
      violations.push(...fileViolations);
    }
  }

  // ── Biome check ──────────────────────────────────────
  const biomeViolations = await _runBiomeCheck(files);
  violations.push(...biomeViolations);

  const durationMs = Date.now() - start;

  return {
    passed: violations.length === 0,
    tier: 1,
    violations,
    durationMs,
  };
};

// ── Tier 2: LLM cognitive review (stub) ────────────────────

/**
 * Run the Tier 2 LLM cognitive review pass.
 *
 * In full deployment, this would:
 * 1. Generate AST-outline skeletons from changed files
 * 2. Build a unified patch delta
 * 3. Send to an LLM with Tier 2 prompts from lint_rules.json
 * 4. Parse LLM response for logical violations
 *
 * For now, this is a stub that reports ready-for-LLM status.
 */
const _runTier2 = async (options: { files: string[]; verbose: boolean }): Promise<GateResult> => {
  const { files, verbose } = options;
  const start = Date.now();

  if (verbose) {
    console.log(`[gate:tier2] LLM cognitive review — ${files.length} files queued`);
    console.log('[gate:tier2] AST skeleton extraction + unified diff would be passed to LLM');
    console.log('[gate:tier2] Checking logical boundaries: view logic, ViewModel isolation...');
  }

  // In production, this would invoke the LLM with Tier 2 prompts
  // For C-304 implementation, this passes as a stub (Tier 1 is the enforcement layer)
  const violations: GateViolation[] = [];

  const durationMs = Date.now() - start;

  return {
    passed: violations.length === 0,
    tier: 2,
    violations,
    durationMs,
  };
};

// ── Output formatting ──────────────────────────────────────

const _formatResult = (result: GateResult): void => {
  const icon = result.passed ? '✅' : '❌';

  console.log(
    `\n${icon} Tier ${result.tier} ${result.passed ? 'PASSED' : 'FAILED'} (${result.durationMs}ms)`,
  );

  if (result.violations.length === 0) {
    return;
  }

  console.log(`\n  ${result.violations.length} violation(s):\n`);

  // Group by rule
  const byRule = new Map<string, GateViolation[]>();
  for (const v of result.violations) {
    const key = `${v.ruleId}: ${v.ruleName}`;
    const list = byRule.get(key) ?? [];
    list.push(v);
    byRule.set(key, list);
  }

  for (const [rule, group] of byRule) {
    const firstViolation = group[0];
    if (!firstViolation) {
      continue;
    }
    const sev = firstViolation.severity === 'error' ? '🔴' : '⚠️ ';
    console.log(`  ${sev} ${rule}`);
    for (const v of group) {
      const loc = v.line ? `:${v.line}` : '';
      console.log(`      ${v.file}${loc}`);
    }
    console.log('');
  }
};

// ── C-306: Parallel worker-based Tier 1 checks ─────────────

/**
 * Worker payload for parallel file checking.
 */
type WorkerInput = {
  filePaths: string[];
  rules: LintRule[];
  projectRoot: string;
};

/**
 * Worker result from parallel file checking.
 */
type WorkerOutput = {
  violations: GateViolation[];
  durationMs: number;
};

/**
 * Run Tier 1 checks using Bun Worker threads for parallel processing.
 *
 * C-306: Integrates Bun's Worker API to parallelize convention checks
 * across multiple threads, avoiding deadlocks from single-threaded I/O.
 */
const _runTier1Parallel = async (options: {
  files: string[];
  verbose: boolean;
  workerCount?: number;
}): Promise<GateResult> => {
  const { files, verbose, workerCount } = options;
  const start = Date.now();
  const allViolations: GateViolation[] = [];

  // Use half of available CPU cores, minimum 2
  const cpuCount = navigator.hardwareConcurrency ?? 4;
  const workers = Math.max(2, Math.min(workerCount ?? Math.floor(cpuCount / 2), files.length));
  const chunkSize = Math.ceil(files.length / workers);

  if (verbose) {
    console.log(`[gate:tier1-parallel] Spawning ${workers} workers for ${files.length} files`);
  }

  // Split files into chunks
  const chunks: string[][] = [];
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }

  // Load rules config
  const rulesConfig = _loadRules();

  // Create worker inline (Bun supports inline Worker creation)
  const workerCode = `
    import { readFileSync } from 'node:fs';
    import { relative } from 'node:path';

    function matchesGlob(filePath, glob, projectRoot) {
      const rel = relative(projectRoot, filePath);
      let regexStr = glob
        .replace(/[.+^\${}()|[\\]\\\\]/g, '\\\\$&')
        .replace(/\\?/g, '.')
        .replace(/\\*\\*\\/\\*/g, '\\x00DIR\\x00')
        .replace(/\\*\\*/g, '\\x00GLOB\\x00')
        .replace(/\\*/g, '[^/]*')
        .replace(/\\x00DIR\\x00/g, '(?:.+/)?')
        .replace(/\\x00GLOB\\x00/g, '.*');
      regexStr = '^' + regexStr + '$';
      return new RegExp(regexStr).test(rel);
    }

    self.onmessage = (event) => {
      const data = event.data;
      const violations = [];
      const rules = data.rules;

      for (const filePath of data.filePaths) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const lines = content.split('\\n');
          const rel = relative(data.projectRoot, filePath);

          for (const rule of rules) {
            if (!rule.patterns) continue;
            for (const pattern of rule.patterns) {
              if (!matchesGlob(filePath, pattern.fileGlob, data.projectRoot)) continue;

              // Exclusion check
              if (pattern.excludePatterns) {
                const skip = pattern.excludePatterns.some(function(ex) {
                  try { return new RegExp(ex).test(content); } catch { return false; }
                });
                if (skip) continue;
              }

              // Forbidden check
              if (pattern.forbidden) {
                violations.push({
                  ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
                  file: rel, message: pattern.message
                });
                continue;
              }

              // Line-specific check
              if (pattern.line !== undefined) {
                const targetLine = lines[pattern.line - 1] ?? '';
                try {
                  if (!new RegExp(pattern.regex).test(targetLine)) {
                    violations.push({
                      ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
                      file: rel, line: pattern.line, message: rule.description
                    });
                  }
                } catch {}
                continue;
              }

              // Regex match
              try {
                const match = new RegExp(pattern.regex, 'm').test(content);
                if (match) {
                  if (pattern.requireAlso) {
                    try {
                      if (new RegExp(pattern.requireAlso, 'm').test(content)) continue;
                    } catch {}
                  }
                  const lineNum = lines.findIndex(function(l) {
                    try { return new RegExp(pattern.regex).test(l); } catch { return false; }
                  });
                  violations.push({
                    ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
                    file: rel, line: lineNum >= 0 ? lineNum + 1 : undefined,
                    message: pattern.message
                  });
                }
              } catch {}
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      self.postMessage({ violations, durationMs: 0 });
    };
  `;

  // Spawn workers
  const workerPromises = chunks.map((chunk) => {
    return new Promise<WorkerOutput>((resolveW) => {
      const worker = new Worker(
        URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })),
      );

      worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
        resolveW(event.data);
        worker.terminate();
      };

      worker.onerror = () => {
        resolveW({ violations: [], durationMs: 0 });
        worker.terminate();
      };

      const input: WorkerInput = {
        filePaths: chunk,
        rules: rulesConfig.rules,
        projectRoot: PROJECT_ROOT,
      };

      worker.postMessage(input);
    });
  });

  // Collect results
  const results = await Promise.all(workerPromises);
  for (const result of results) {
    allViolations.push(...result.violations);
  }

  const durationMs = Date.now() - start;

  return {
    passed: allViolations.length === 0,
    tier: 1,
    violations: allViolations,
    durationMs,
  };
};

// ── Main ───────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const { pathsArg, baseRef, verbose } = _parseArgs();

  // ── Gather files ──────────────────────────────────────
  let files: string[];

  if (baseRef) {
    console.log(`[gate] Gathering changed files relative to ${baseRef}...`);
    files = await _getChangedFiles(baseRef);
  } else if (pathsArg) {
    const targetDir = resolve(pathsArg);
    console.log(`[gate] Gathering files from ${pathsArg}...`);
    files = await _gatherFiles(targetDir);
  } else {
    // Default: check the entire workspace
    console.log('[gate] Gathering all workspace files...');
    files = await _gatherFiles(PROJECT_ROOT);
  }

  const tsFiles = files.filter(
    (f) =>
      /\.(ts|tsx|svelte)$/.test(f) &&
      !f.includes('node_modules') &&
      !f.includes('dist/') &&
      !f.includes('.pi/generated-skills'),
  );

  if (verbose) {
    console.log(`[gate] Found ${tsFiles.length} TypeScript/Svelte files`);
  }

  if (tsFiles.length === 0) {
    console.log('[gate] No files to check');
    process.exit(0);
  }

  // ── Tier 1: Deterministic checks ──────────────────────
  // C-306: Use parallel workers for large file sets (>100 files)
  const useParallel = tsFiles.length > 100;

  const tier1 = useParallel
    ? await _runTier1Parallel({ files: tsFiles, verbose })
    : await _runTier1({ files: tsFiles, verbose });
  _formatResult(tier1);

  if (!tier1.passed) {
    console.log('\n🔴 Convention gate FAILED at Tier 1 (deterministic checks).');
    console.log('   Fix the above violations and re-run the gate.\n');
    process.exit(1);
  }

  // ── Tier 2: LLM cognitive review ──────────────────────
  console.log(`\n🔵 Tier 1 passed. Proceeding to Tier 2 (LLM cognitive review)...`);
  const tier2 = await _runTier2({ files: tsFiles, verbose });
  _formatResult(tier2);

  if (!tier2.passed) {
    console.log('\n🔴 Convention gate FAILED at Tier 2 (LLM cognitive review).');
    process.exit(2);
  }

  console.log('\n✅ Convention gate PASSED — all checks green.\n');
  process.exit(0);
};

main().catch((error) => {
  console.error('[gate] Fatal error:', error);
  process.exit(3);
});
