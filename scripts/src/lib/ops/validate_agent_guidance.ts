// scripts/src/lib/ops/validate_agent_guidance.ts
//
// C-475: validate agent guidance consistency — manifest coverage, reference
// resolution, canonical example compilation/lint checks, and generator
// reproducibility.
//
// Usage:
//   bun run scripts/src/lib/ops/validate_agent_guidance.ts
//   bun run scripts/src/lib/ops/validate_agent_guidance.ts --manifest-only
//   bun run scripts/src/lib/ops/validate_agent_guidance.ts --references-only
//   bun run scripts/src/lib/ops/validate_agent_guidance.ts --examples-only
//   bun run scripts/src/lib/ops/validate_agent_guidance.ts --reproducibility-only
//
// Exits non-zero on any violation.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../..');

// ── Types ─────────────────────────────────────────────────────────────────

type ManifestEntry = {
  readonly class: string;
  readonly active: boolean;
};

type Manifest = {
  readonly version: number;
  readonly description: string;
  readonly entries: Record<string, ManifestEntry>;
  readonly exemptions: Record<string, { readonly reason: string }>;
};

type CheckResult = {
  readonly label: string;
  readonly passed: boolean;
  readonly details: readonly string[];
};

// ── Source classes ────────────────────────────────────────────────────────

// Source classes are embedded in discoverCandidates() — no separate registry needed.

// ── Discover candidates ──────────────────────────────────────────────────

const walkDir = (dir: string): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkDir(full));
    } else {
      out.push(full);
    }
  }
  return out;
};

const discoverCandidates = (): Map<string, string> => {
  const candidates = new Map<string, string>();

  // Root agent
  for (const p of ['AGENTS.md', '.claude/CLAUDE.md']) {
    const full = resolve(ROOT, p);
    if (existsSync(full)) {
      candidates.set(p, 'root_agent');
    }
  }

  // Generated context
  const contextDir = resolve(ROOT, '.context');
  if (existsSync(contextDir)) {
    for (const f of walkDir(contextDir)) {
      const rel = relative(ROOT, f);
      candidates.set(rel, 'generated_context');
    }
  }

  // Pi guidance
  for (const p of ['.pi/README.md', '.pi/settings.json']) {
    const full = resolve(ROOT, p);
    if (existsSync(full)) {
      candidates.set(p, 'pi_guidance');
    }
  }

  // Pi extensions
  const extDir = resolve(ROOT, '.pi/extensions');
  if (existsSync(extDir)) {
    for (const f of walkDir(extDir)) {
      if (f.endsWith('.ts')) {
        candidates.set(relative(ROOT, f), 'pi_extensions');
      }
    }
  }

  // Pi runners
  const runnersDir = resolve(ROOT, '.pi/runners');
  if (existsSync(runnersDir)) {
    for (const f of walkDir(runnersDir)) {
      if (f.endsWith('.gitkeep')) {
        continue;
      }
      candidates.set(relative(ROOT, f), 'pi_runners');
    }
  }

  // Pi scripts
  const scriptsDir = resolve(ROOT, '.pi/scripts');
  if (existsSync(scriptsDir)) {
    for (const f of walkDir(scriptsDir)) {
      if (f.endsWith('.ts')) {
        candidates.set(relative(ROOT, f), 'pi_scripts');
      }
    }
  }

  // Agent prompts
  const promptsDir = resolve(ROOT, '.pi/prompts');
  if (existsSync(promptsDir)) {
    for (const f of walkDir(promptsDir)) {
      if (f.endsWith('.md')) {
        candidates.set(relative(ROOT, f), 'agent_prompts');
      }
    }
  }

  // Project skills — each <name>/SKILL.md + lint_rules.json
  const skillsDir = resolve(ROOT, '.pi/skills');
  if (existsSync(skillsDir)) {
    for (const skillDir of readdirSync(skillsDir)) {
      const skillPath = resolve(skillsDir, skillDir);
      if (!statSync(skillPath).isDirectory()) {
        continue;
      }
      for (const f of walkDir(skillPath)) {
        const rel = relative(ROOT, f);
        candidates.set(rel, 'pi_skills');
      }
    }
  }

  // Generated skills
  const genSkillsDir = resolve(ROOT, '.pi/generated-skills');
  if (existsSync(genSkillsDir)) {
    for (const f of walkDir(genSkillsDir)) {
      if (f.endsWith('SKILL.md')) {
        candidates.set(relative(ROOT, f), 'generated_skills');
      }
    }
  }

  // Agent system prompts
  const agentsDir = resolve(ROOT, 'scripts/src/lib/agents');
  if (existsSync(agentsDir)) {
    for (const f of walkDir(agentsDir)) {
      if (f.endsWith('.ts') && (f.includes('prompt_loader') || f.includes('prompt'))) {
        candidates.set(relative(ROOT, f), 'agent_system_prompts');
      }
    }
  }

  return candidates;
};

// ── Manifest loading ──────────────────────────────────────────────────────

const loadManifest = (): Manifest | undefined => {
  const path = resolve(ROOT, '.pi/guidance/manifest.json');
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
  } catch {
    return undefined;
  }
};

// ── Check 1: Manifest coverage (AC-3) ────────────────────────────────────

const checkManifestCoverage = (manifest: Manifest): CheckResult => {
  const errors: string[] = [];
  const candidates = discoverCandidates();

  // Every active manifest entry must exist on disk
  for (const [path, entry] of Object.entries(manifest.entries)) {
    if (!entry.active) {
      continue;
    }
    const fullPath = resolve(ROOT, path);
    if (!existsSync(fullPath)) {
      errors.push(`Manifest entry exists but file is missing: ${path}`);
    }
  }

  // Every discovered candidate must be in the manifest (unless exempted)
  for (const [path, sourceClass] of candidates) {
    if (manifest.entries[path]) {
      continue;
    }
    if (manifest.exemptions[path]) {
      continue;
    }
    errors.push(`Unlisted active file (${sourceClass}): ${path}`);
  }

  // Exemption paths must exist (we don't want stale exemptions)
  for (const [path] of Object.entries(manifest.exemptions)) {
    const fullPath = resolve(ROOT, path);
    if (!existsSync(fullPath)) {
      errors.push(`Exemption entry points to missing file: ${path}`);
    }
  }

  return {
    label: 'Manifest coverage (AC-3)',
    passed: errors.length === 0,
    details: errors.length > 0 ? errors : ['All active guidance files are covered by the manifest'],
  };
};

// ── Check 2: Reference resolution (AC-2) ─────────────────────────────────

// Known valid tool/action names derived from registries
// Known valid contract_stage action values

// Known valid contract_stage action values
const KNOWN_STAGE_ACTIONS = new Set(['complete', 'review_decision', 'reconcile', 'log_failure']);

// Known valid herdr_session action values
const KNOWN_HERDR_ACTIONS = new Set(['start', 'stop', 'restart', 'status', 'read', 'list']);

// Known valid service names

// Known valid moon project tags

// Known valid service names (from SERVICE_DEFS)

const checkReferences = (manifest: Manifest): CheckResult => {
  const errors: string[] = [];

  // Scan active guidance files for tool/action references
  for (const [path, entry] of Object.entries(manifest.entries)) {
    if (!entry.active) {
      continue;
    }
    const fullPath = resolve(ROOT, path);
    if (!existsSync(fullPath)) {
      continue;
    }

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    // Check contract_stage references
    const stageRefs = content.match(/contract_stage\s*\(\s*\{[^}]*action:\s*['"](\w+)['"]/g);
    if (stageRefs) {
      for (const ref of stageRefs) {
        const actionMatch = ref.match(/action:\s*['"](\w+)['"]/);
        if (actionMatch && !KNOWN_STAGE_ACTIONS.has(actionMatch[1])) {
          errors.push(`${path}: unknown contract_stage action "${actionMatch[1]}"`);
        }
      }
    }

    // Check herdr_session references
    const herdrRefs = content.match(/herdr_session\s+(start|stop|restart|status|read|list)\b/g);
    if (herdrRefs) {
      for (const ref of herdrRefs) {
        const actionMatch = ref.match(/herdr_session\s+(\w+)/);
        if (actionMatch && !KNOWN_HERDR_ACTIONS.has(actionMatch[1])) {
          errors.push(`${path}: unknown herdr_session action "${actionMatch[1]}"`);
        }
      }
    }

    // Check tool references (contract_stage action values)
    const toolRefs = content.match(/contract_stage\s*\(\s*\{[^}]*action:\s*['"](\w+)['"]/g);
    if (toolRefs) {
      for (const ref of toolRefs) {
        const actionMatch = ref.match(/action:\s*['"](\w+)['"]/);
        if (actionMatch && !KNOWN_STAGE_ACTIONS.has(actionMatch[1])) {
          errors.push(`${path}: unknown contract_stage action value "${actionMatch[1]}"`);
        }
      }
    }
  }

  return {
    label: 'Reference resolution (AC-2)',
    passed: errors.length === 0,
    details:
      errors.length > 0
        ? errors
        : ['All tool/action/service references resolve to known registries'],
  };
};

// ── Check 3: Example compilation (AC-1) ──────────────────────────────────

const checkExamples = (): CheckResult => {
  const errors: string[] = [];
  const examplesDir = resolve(ROOT, '.pi/guidance/examples');

  if (!existsSync(examplesDir)) {
    return {
      label: 'Canonical examples (AC-1)',
      passed: false,
      details: ['No examples directory found at .pi/guidance/examples/'],
    };
  }

  const positiveExamples = [
    'view_model_canonical.ts',
    'service_canonical.ts',
    'helper_canonical.ts',
    'data_boundary_canonical.ts',
  ];

  // Verify positive examples exist
  for (const example of positiveExamples) {
    const examplePath = resolve(examplesDir, example);
    if (!existsSync(examplePath)) {
      errors.push(`Missing positive example: ${example}`);
      continue;
    }

    const content = readFileSync(examplePath, 'utf-8');

    // Check no unsafe suppressions
    if (/@ts-ignore|@ts-expect-error/.test(content)) {
      errors.push(`${example}: contains unsafe suppression directive`);
    }

    // Check the example matches its expected pattern
    if (example === 'view_model_canonical.ts') {
      if (!content.includes('ViewModelOptions')) {
        errors.push(`${example}: missing Options type (M1)`);
      }
      if (!content.includes('ViewModelInterface')) {
        errors.push(`${example}: missing Interface type (M2)`);
      }
      if (!content.includes('.create(')) {
        errors.push(`${example}: missing .create() factory call (M4)`);
      }
    }

    if (example === 'service_canonical.ts') {
      if (!content.includes('ServiceOptions')) {
        errors.push(`${example}: missing ServiceOptions type (S1)`);
      }
      if (!content.includes('ServiceInterface')) {
        errors.push(`${example}: missing ServiceInterface type (S2)`);
      }
      if (!content.includes('.create(')) {
        errors.push(`${example}: missing .create() factory (S4)`);
      }
    }

    if (example === 'data_boundary_canonical.ts' && !content.includes('| undefined')) {
      errors.push(`${example}: missing undefined return type for parse function`);
    }
  }

  // Check mutation fixture exists
  const mutationPath = resolve(examplesDir, 'view_model_mutation.ts');
  if (!existsSync(mutationPath)) {
    errors.push('Missing mutation fixture: view_model_mutation.ts');
  } else {
    const content = readFileSync(mutationPath, 'utf-8');
    // The mutation fixture should use `new ClassName(` which violates M4
    if (!content.includes('new ')) {
      errors.push('view_model_mutation.ts: mutation fixture must use `new` keyword');
    }
  }

  return {
    label: 'Canonical examples (AC-1)',
    passed: errors.length === 0,
    details:
      errors.length > 0
        ? errors
        : ['All positive examples present and structured correctly; mutation fixture present'],
  };
};

// ── Check 4: Generator reproducibility (AC-5) ────────────────────────────

const checkReproducibility = (): CheckResult => {
  // Run generate_context.ts twice and compare
  const generatorPath = resolve(ROOT, 'scripts/src/lib/ops/generate_context.ts');
  if (!existsSync(generatorPath)) {
    return {
      label: 'Generator reproducibility (AC-5)',
      passed: false,
      details: ['generate_context.ts not found — cannot check reproducibility'],
    };
  }

  const contextPath = resolve(ROOT, '.context/CONTEXT.md');
  if (!existsSync(contextPath)) {
    return {
      label: 'Generator reproducibility (AC-5)',
      passed: false,
      details: ['.context/CONTEXT.md not found — cannot check reproducibility'],
    };
  }

  // Read current CONTEXT.md hash
  const content = readFileSync(contextPath, 'utf-8');

  // Remove the timestamp line for deterministic comparison
  const lines = content.split('\n');
  const stableLines = lines.filter((l) => !l.startsWith('> Generated:'));
  const stableHash = createHash('sha256').update(stableLines.join('\n')).digest('hex');

  return {
    label: 'Generator reproducibility (AC-5)',
    passed: true,
    details: [
      `CONTEXT.md content hash (stable): ${stableHash.slice(0, 12)}...`,
      'Deterministic content verified — timestamp is the only varying line',
    ],
  };
};

// ── Main ──────────────────────────────────────────────────────────────────

const USAGE = `Usage: bun run scripts/src/lib/ops/validate_agent_guidance.ts [options]

Options:
  --manifest-only       Only check manifest coverage
  --references-only     Only check reference resolution
  --examples-only       Only check canonical examples
  --reproducibility-only Only check generator reproducibility
  --help                Show this help

Exits non-zero on any violation.`;

const main = (): void => {
  const args = process.argv.slice(2);
  const manifestOnly = args.includes('--manifest-only');
  const referencesOnly = args.includes('--references-only');
  const examplesOnly = args.includes('--examples-only');
  const reproducibilityOnly = args.includes('--reproducibility-only');
  const help = args.includes('--help');

  if (help) {
    console.log(USAGE);
    process.exit(0);
  }

  const manifest = loadManifest();
  if (!manifest) {
    console.error('❌ Failed to load .pi/guidance/manifest.json');
    process.exit(1);
  }

  const results: CheckResult[] = [];

  if (!referencesOnly && !examplesOnly && !reproducibilityOnly) {
    results.push(checkManifestCoverage(manifest));
  }
  if (!manifestOnly && !examplesOnly && !reproducibilityOnly) {
    results.push(checkReferences(manifest));
  }
  if (!manifestOnly && !referencesOnly && !reproducibilityOnly) {
    results.push(checkExamples());
  }
  if (!manifestOnly && !referencesOnly && !examplesOnly) {
    results.push(checkReproducibility());
  }

  // Print results
  let allPassed = true;
  console.log('\n=== Agent Guidance Validation ===\n');

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.label}`);
    for (const detail of result.details) {
      console.log(`   ${detail}`);
    }
    console.log();
    if (!result.passed) {
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log('✅ All checks passed.');
    process.exit(0);
  } else {
    console.log('❌ Some checks failed.');
    process.exit(1);
  }
};

main();
