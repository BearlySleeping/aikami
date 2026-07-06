// scripts/src/lib/agents/skill_optimizer.ts
/**
 * Swarm Post-Mortem & Meta-Reflective Skill Optimizer (C-308).
 *
 * Autonomous reflection and tuning layer. When a development sub-agent fails
 * convention gate checks or triggers visual regression errors multiple times,
 * the optimizer:
 * 1. Ingests validation logs and failure traces
 * 2. Analyzes code modifications applied
 * 3. Deduces the root convention misunderstanding
 * 4. Dynamically adjusts skill markdown or linter rules
 * 5. Version-bumps modified files
 * 6. Writes audit entries to the scratchpad
 *
 * Strict modification limits:
 * - May ONLY write to .pi/skills/**\/*.md and lint_rules.json
 * - Strictly FORBIDDEN from editing source repositories
 * - Must validate against immutable core pillars
 *
 * Usage:
 *   bun run scripts/src/lib/agents/skill_optimizer.ts --analyze-failure prefix-error-01
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

// ── Types ──────────────────────────────────────────────────

/** Post-mortem anomaly extracted from failure logs. */
export type PostMortemAnomalies = {
  failedAgentKey: string;
  violatedRuleIdentifier: string;
  detectedMisunderstandingTraces: string;
  suggestedInstructionAdjustment: string;
};

/** Audit entry for skill/rule modifications. */
export type OptimizationAuditEntry = {
  optimizationId: string;
  targetSkillPath: string;
  previousVersion: string;
  nextVersion: string;
  changeSummaryText: string;
  timestamp: string;
};

/** Immutable core pillar — may never be modified by the optimizer. */
export type ImmutablePillar = {
  id: string;
  name: string;
  description: string;
};

/** Optimization session context. */
export type OptimizationSession = {
  sessionId: string;
  anomalies: PostMortemAnomalies[];
  auditLog: OptimizationAuditEntry[];
  startedAt: string;
};

// ── Constants ──────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const SKILLS_DIR = resolve(PROJECT_ROOT, '.pi', 'skills');
const RULES_PATH = resolve(PROJECT_ROOT, '.pi', 'skills', 'aikami-conventions', 'lint_rules.json');
const AUDIT_LOG_PATH = resolve(PROJECT_ROOT, '.pi', 'optimization_audit.json');

/** Immutable core pillars — legally blocked from modification. */
const IMMUTABLE_PILLARS: ImmutablePillar[] = [
  {
    id: 'PILLAR-TAURI-SPA',
    name: 'Tauri SPA — No Server Routes',
    description:
      'The client is a static SPA. +server.ts, +page.server.ts, +layout.server.ts files must never exist in client routes.',
  },
  {
    id: 'PILLAR-SHARED-BOUNDARIES',
    name: 'Monorepo Boundaries — Shared Packages Only',
    description:
      'Domain types, schemas, and constants must never be defined in app-level code. They belong in packages/shared/.',
  },
  {
    id: 'PILLAR-MVVM-ISOLATION',
    name: 'MVVM Layer Isolation',
    description:
      'Views have zero logic. ViewModels delegate to services. Services never import repositories. Database layers are repository-only.',
  },
  {
    id: 'PILLAR-PRIVATE-UNDERSCORE',
    name: 'Private Field Underscore Prefix',
    description:
      'All private class members must use a leading _ prefix. $state ViewModel fields are exempt.',
  },
];

// ── Skill markdown metadata ────────────────────────────────

/** Extract version metadata from a skill markdown file. */
const _extractSkillVersion = (content: string): string => {
  const match = /version:\s*(\d+\.\d+\.\d+)/i.exec(content);
  return match?.[1] ?? '0.0.0';
};

/** Bump the patch version of a semver string. */
const _bumpVersion = (version: string): string => {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3) {
    return '0.0.1';
  }
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
};

/** Replace the version metadata line in a skill markdown file. */
const _updateSkillVersion = (content: string, newVersion: string): string =>
  content.replace(/version:\s*\d+\.\d+\.\d+/i, `version: ${newVersion}`);

// ── Failure log parsing ────────────────────────────────────

/**
 * Parse a failure log to extract post-mortem anomalies.
 *
 * AC-1: Root-Cause Misunderstanding Extraction
 * - Evaluates patch history and error logs
 * - Isolates the exact rule that was misunderstood
 * - Outputs structured explanation to scratchpad
 */
const _parseFailureLog = (logContent: string, agentKey: string): PostMortemAnomalies[] => {
  const anomalies: PostMortemAnomalies[] = [];

  // ── Detect violated rules from Biome output ────────────
  const rulePattern = /lint\/(\S+)\s+(\S+)/g;
  let match: RegExpExecArray | null;
  const seenRules = new Set<string>();

  while (true) {
    match = rulePattern.exec(logContent);
    if (match === null) {
      break;
    }
    const ruleId = match[1];
    if (seenRules.has(ruleId)) {
      continue;
    }
    seenRules.add(ruleId);

    // Map rule to known convention categories
    const traces = _deduceMisunderstanding(ruleId, logContent);

    anomalies.push({
      failedAgentKey: agentKey,
      violatedRuleIdentifier: ruleId,
      detectedMisunderstandingTraces: traces.misunderstanding,
      suggestedInstructionAdjustment: traces.adjustment,
    });
  }

  return anomalies;
};

/**
 * Deduce the likely misunderstanding behind a violated rule.
 * Maps rule IDs to known convention categories and generates adjustment suggestions.
 */
const _deduceMisunderstanding = (
  ruleId: string,
  _logContent: string,
): { misunderstanding: string; adjustment: string } => {
  const ruleMap: Record<string, { misunderstanding: string; adjustment: string }> = {
    useNamingConvention: {
      misunderstanding:
        'Agent used snake_case in type properties but $state fields or public members should use camelCase. May confuse external API contract shapes with internal naming.',
      adjustment:
        'Clarify: $state and public class members use camelCase. Only herdr/SQLite/OpenRouter API shapes may use snake_case (with biome override).',
    },
    noExplicitAny: {
      misunderstanding:
        'Agent used `any` type instead of `unknown` with a type guard. May not understand TypeScript strictness requirements in the project.',
      adjustment:
        'Add rule: NEVER use `any`. Use `unknown` with type guards. This is enforced by Biome noExplicitAny.',
    },
    useFilenamingConvention: {
      misunderstanding:
        'Agent created files with camelCase or PascalCase names instead of snake_case.',
      adjustment:
        'Add example: ✅ auth_service.ts, ❌ authService.ts, AuthService.ts. All files use snake_case only.',
    },
    noConsole: {
      misunderstanding:
        'Agent used console.log in library code instead of the logger. May not know the $logger alias convention.',
      adjustment:
        'Add rule: Always use $logger alias, never console.log directly in library code. Exception: CLI scripts and .pi runners.',
    },
    CLS_001: {
      misunderstanding:
        'Agent defined a private class member without the leading underscore (_) prefix.',
      adjustment:
        'Add explicit example: private _cache = new Map() ✅ vs private cache = new Map() ❌.',
    },
    SRC_001: {
      misunderstanding: 'Agent created a file without the required path comment on line 1.',
      adjustment:
        'Add template: Every .ts file must start with `// apps/.../file.ts` comment on line 1.',
    },
  };

  const entry = ruleMap[ruleId];
  if (entry) {
    return entry;
  }

  return {
    misunderstanding: `Agent triggered rule "${ruleId}" — specific misunderstanding not yet catalogued.`,
    adjustment: `Review rule "${ruleId}" documentation and add clarifying examples to the relevant skill file.`,
  };
};

// ── Immutable pillar validation ────────────────────────────

/**
 * Check that a proposed rule update does not conflict with any immutable pillar.
 *
 * Edge case: Instruction Contradiction Loops
 * If the optimizer writes a rule that conflicts with a core pillar, the
 * swarm falls into an unrecoverable compilation trap.
 */
const _validateAgainstPillars = (proposedText: string): { valid: boolean; conflicts: string[] } => {
  const conflicts: string[] = [];
  const lower = proposedText.toLowerCase();

  for (const pillar of IMMUTABLE_PILLARS) {
    // Check for negation patterns — any text suggesting the opposite of a pillar
    const contradictionPatterns = [
      /\+server\.ts\s+is\s+(?:allowed|acceptable|ok|fine)/i,
      /define\s+(?:types|schemas|constants)\s+in\s+(?:apps|app-level|service\s+files)/i,
      /views?\s+(?:may|can|should)\s+(?:contain|have|include)\s+(?:logic|state|derived|\$state)/i,
      /private\s+(?:members?|fields?)\s+(?:may|can|don't\s+need)\s+(?:omit|skip|lack)\s+underscore/i,
    ];

    for (const pattern of contradictionPatterns) {
      if (pattern.test(lower)) {
        conflicts.push(`Proposed text conflicts with ${pillar.id}: ${pillar.name}`);
      }
    }
  }

  return { valid: conflicts.length === 0, conflicts };
};

// ── Lint rules JSON validation ─────────────────────────────

/** Validate a JSON string as valid JSON and roughly conforming to the lint_rules schema. */
const _validateLintRulesJson = (jsonText: string): { valid: boolean; error?: string } => {
  try {
    const parsed = JSON.parse(jsonText) as unknown;

    if (typeof parsed !== 'object' || parsed === null) {
      return { valid: false, error: 'Not a valid JSON object' };
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.version !== 'string') {
      return { valid: false, error: 'Missing or invalid "version" field' };
    }

    if (!Array.isArray(obj.rules)) {
      return { valid: false, error: 'Missing or invalid "rules" array' };
    }

    // Validate each rule has required fields
    for (let i = 0; i < obj.rules.length; i++) {
      const rule = obj.rules[i] as Record<string, unknown>;
      if (typeof rule.id !== 'string' || typeof rule.name !== 'string') {
        return { valid: false, error: `Rule at index ${i} missing required fields (id, name)` };
      }
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid JSON: ${String(error)}` };
  }
};

// ── Skill file update ──────────────────────────────────────

/**
 * Update a skill markdown file with clarified rule text.
 *
 * AC-2: Autonomous Rule Sheet Self-Healing
 * - Safely rewrites target .pi/skills/SKILL.md
 * - Increments system version string
 * - Appends description to audit ledger
 * - Syncs linter index
 */
const _updateSkillFile = (options: {
  skillPath: string;
  anomaly: PostMortemAnomalies;
  auditLog: OptimizationAuditEntry[];
}): OptimizationAuditEntry | null => {
  const { skillPath, anomaly, auditLog } = options;
  const fullPath = resolve(SKILLS_DIR, skillPath);

  if (!existsSync(fullPath)) {
    console.warn(`[optimizer] Skill file not found: ${fullPath}`);
    return null;
  }

  // Read current content
  const content = readFileSync(fullPath, 'utf-8');
  const previousVersion = _extractSkillVersion(content);

  // Validate the path is within .pi/skills/ (security check)
  const relPath = relative(SKILLS_DIR, fullPath);
  if (!relPath.startsWith('..')) {
    // Path is safe — within skills directory
  } else {
    console.warn(`[optimizer] Security: skill path escapes skills directory: ${fullPath}`);
    return null;
  }

  // Build the clarification block to append
  const clarificationBlock = `
<!-- OPT-AUTO ${anomaly.violatedRuleIdentifier} -->
### Auto-Clarification: ${anomaly.violatedRuleIdentifier}

> ⚠️ This section was auto-generated by the skill optimizer (C-308) after detecting a repeated convention violation.

**Misunderstanding detected**:
${anomaly.detectedMisunderstandingTraces}

**Clarification**:
${anomaly.suggestedInstructionAdjustment}

**Violated rule**: \`${anomaly.violatedRuleIdentifier}\`
**Agent**: ${anomaly.failedAgentKey}
`;

  let updatedContent = content;

  // Check if this rule already has an auto-clarification (avoid duplicates)
  const existingMarker = `OPT-AUTO ${anomaly.violatedRuleIdentifier}`;
  if (content.includes(existingMarker)) {
    // Replace the existing block
    const blockPattern = new RegExp(
      `<!-- ${existingMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->[\\s\\S]*?(?=<!--|$)`,
    );
    updatedContent = content.replace(blockPattern, clarificationBlock);
  } else {
    // Append to end of file
    updatedContent = `${content.trimEnd()}\n\n${clarificationBlock}\n`;
  }

  // Validate against immutable pillars
  const pillarCheck = _validateAgainstPillars(updatedContent);
  if (!pillarCheck.valid) {
    console.error(
      '[optimizer] BLOCKED: Proposed skill update conflicts with immutable pillars:',
      pillarCheck.conflicts,
    );
    return null;
  }

  // Increment version
  const nextVersion = _bumpVersion(previousVersion);
  updatedContent = _updateSkillVersion(updatedContent, nextVersion);

  // Write updated file
  writeFileSync(fullPath, updatedContent);

  const entry: OptimizationAuditEntry = {
    optimizationId: createHash('sha256')
      .update(`${skillPath}_${Date.now()}_${anomaly.violatedRuleIdentifier}`)
      .digest('hex')
      .slice(0, 16),
    targetSkillPath: skillPath,
    previousVersion,
    nextVersion,
    changeSummaryText: `Added auto-clarification for ${anomaly.violatedRuleIdentifier} (agent: ${anomaly.failedAgentKey})`,
    timestamp: new Date().toISOString(),
  };

  auditLog.push(entry);

  return entry;
};

// ── Lint rules update ──────────────────────────────────────

/**
 * Update lint_rules.json with a modified or new rule.
 *
 * Watch point: All automated rule updates must be validated against
 * the lint_rules schema before writing to disk.
 */
const _updateLintRules = (options: {
  anomaly: PostMortemAnomalies;
  auditLog: OptimizationAuditEntry[];
}): OptimizationAuditEntry | null => {
  const { anomaly, auditLog } = options;

  if (!existsSync(RULES_PATH)) {
    console.warn('[optimizer] lint_rules.json not found');
    return null;
  }

  const content = readFileSync(RULES_PATH, 'utf-8');
  const previousVersion = _extractSkillVersion(content);

  // Parse current rules
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    console.error('[optimizer] lint_rules.json is not valid JSON — cannot update');
    return null;
  }

  // Check if the violated rule already exists
  const rules = (parsed.rules as Array<Record<string, unknown>>) ?? [];
  const existingIdx = rules.findIndex((r) => r.id === anomaly.violatedRuleIdentifier);

  if (existingIdx >= 0) {
    // Enhance existing rule with clarification
    const existingRule = rules[existingIdx] as Record<string, unknown>;
    existingRule.autoClarification = anomaly.suggestedInstructionAdjustment;
    existingRule.lastOptimizedAt = new Date().toISOString();
    rules[existingIdx] = existingRule;
  }

  parsed.rules = rules;
  const nextVersion = _bumpVersion(previousVersion);
  parsed.version = nextVersion;

  const updatedJson = JSON.stringify(parsed, null, 2);

  // Validate before writing
  const validation = _validateLintRulesJson(updatedJson);
  if (!validation.valid) {
    console.error(
      '[optimizer] BLOCKED: Updated lint_rules.json failed validation:',
      validation.error,
    );
    return null;
  }

  writeFileSync(RULES_PATH, updatedJson);

  const entry: OptimizationAuditEntry = {
    optimizationId: createHash('sha256')
      .update(`lint_rules_${Date.now()}_${anomaly.violatedRuleIdentifier}`)
      .digest('hex')
      .slice(0, 16),
    targetSkillPath: '.pi/skills/aikami-conventions/lint_rules.json',
    previousVersion,
    nextVersion,
    changeSummaryText: `Enhanced rule ${anomaly.violatedRuleIdentifier} with auto-clarification`,
    timestamp: new Date().toISOString(),
  };

  auditLog.push(entry);

  return entry;
};

// ── Audit log persistence ──────────────────────────────────

/** Read and return the current audit log. */
const _readAuditLog = (): OptimizationAuditEntry[] => {
  if (!existsSync(AUDIT_LOG_PATH)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(AUDIT_LOG_PATH, 'utf-8')) as OptimizationAuditEntry[];
  } catch {
    return [];
  }
};

/** Write the audit log to disk. */
const _writeAuditLog = (entries: OptimizationAuditEntry[]): void => {
  writeFileSync(AUDIT_LOG_PATH, JSON.stringify(entries, null, 2));
};

// ── Skill file discovery ───────────────────────────────────

/**
 * Find the most relevant skill markdown file for a given anomaly.
 * Maps rule IDs to known skill file paths.
 */
const _findRelevantSkillPath = (anomaly: PostMortemAnomalies): string | null => {
  const ruleMap: Record<string, string> = {
    useNamingConvention: 'aikami-conventions/SKILL.md',
    useFilenamingConvention: 'aikami-conventions/SKILL.md',
    noExplicitAny: 'aikami-conventions/SKILL.md',
    CLS_001: 'aikami-conventions/SKILL.md',
    SRC_001: 'aikami-conventions/SKILL.md',
    noConsole: 'aikami-conventions/SKILL.md',
    useImportType: 'aikami-conventions/SKILL.md',
    VEW_001: 'svelte-page/SKILL.md',
    VEW_002: 'svelte-page/SKILL.md',
    IMP_001: 'aikami-conventions/SKILL.md',
    SIG_001: 'aikami-conventions/SKILL.md',
    RTE_001: 'aikami-conventions/SKILL.md',
  };

  return ruleMap[anomaly.violatedRuleIdentifier] ?? 'aikami-conventions/SKILL.md';
};

// ── Public API ─────────────────────────────────────────────

/**
 * Execute a post-mortem analysis on a failure log, automatically
 * updating skill files and lint rules to prevent future occurrences.
 *
 * AC-1: Root-Cause Misunderstanding Extraction
 * AC-2: Autonomous Rule Sheet Self-Healing
 */
export const analyzeFailure = (options: {
  /** Path to the failure log file */
  logPath: string;
  /** Key of the failing agent (architect, coder, qa, git) */
  agentKey: string;
  /** Optional target skill path override */
  skillPath?: string;
}): OptimizationSession => {
  const { logPath, agentKey, skillPath } = options;

  const fullLogPath = resolve(PROJECT_ROOT, logPath);

  if (!existsSync(fullLogPath)) {
    throw new Error(`Failure log not found: ${fullLogPath}`);
  }

  const logContent = readFileSync(fullLogPath, 'utf-8');

  // ── Step 1: Parse anomalies ────────────────────────────
  const anomalies = _parseFailureLog(logContent, agentKey);

  console.log(`[optimizer] Found ${anomalies.length} anomaly(s) in failure log`);

  const auditLog: OptimizationAuditEntry[] = [];

  // ── Step 2: For each anomaly, update relevant skill files ──
  for (const anomaly of anomalies) {
    console.log(`[optimizer] Processing: ${anomaly.violatedRuleIdentifier}`);

    const targetSkill = skillPath ?? _findRelevantSkillPath(anomaly);
    if (!targetSkill) {
      console.warn(`[optimizer] No skill file mapped for rule: ${anomaly.violatedRuleIdentifier}`);
      continue;
    }

    // ── Update skill markdown ────────────────────────────
    const skillEntry = _updateSkillFile({
      skillPath: targetSkill,
      anomaly,
      auditLog,
    });

    if (skillEntry) {
      console.log(
        `[optimizer] Updated skill: ${targetSkill} (v${skillEntry.previousVersion} → v${skillEntry.nextVersion})`,
      );
    }

    // ── Update lint_rules.json ───────────────────────────
    const rulesEntry = _updateLintRules({ anomaly, auditLog });

    if (rulesEntry) {
      console.log(
        `[optimizer] Updated lint_rules.json (v${rulesEntry.previousVersion} → v${rulesEntry.nextVersion})`,
      );
    }
  }

  // ── Step 3: Persist audit log ──────────────────────────
  const existingLog = _readAuditLog();
  existingLog.push(...auditLog);
  _writeAuditLog(existingLog);

  console.log(`\n[optimizer] Optimization complete — ${auditLog.length} change(s) in audit log`);

  return {
    sessionId: createHash('sha256').update(`${agentKey}_${Date.now()}`).digest('hex').slice(0, 12),
    anomalies,
    auditLog,
    startedAt: new Date().toISOString(),
  };
};

// ── CLI ────────────────────────────────────────────────────

const main = (): void => {
  const args = process.argv.slice(2);
  const analyzeIdx = args.indexOf('--analyze-failure');
  const failureId = analyzeIdx !== -1 ? args[analyzeIdx + 1] : undefined;

  if (!failureId) {
    console.error('Usage: bun run skill_optimizer.ts --analyze-failure <failure-id>');
    process.exit(1);
  }

  // Build log path from failure ID
  const logPath = `.pi/failure_logs/${failureId}.log`;

  analyzeFailure({
    logPath,
    agentKey: 'coder', // Default to coder agent
  });
};

main();
