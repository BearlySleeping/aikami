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

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { KNOWN_SERVICES } from '../herdr/session';

const ROOT = resolve(import.meta.dir, '../../../..');

// ── Types ─────────────────────────────────────────────────────────────────

export type ManifestEntry = {
  readonly class: string;
  readonly active: boolean;
};

export type Manifest = {
  readonly version: number;
  readonly description: string;
  readonly entries: Record<string, ManifestEntry>;
  readonly exemptions: Record<string, { readonly reason: string }>;
};

export type CheckResult = {
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

const discoverCandidates = (root = ROOT): Map<string, string> => {
  const candidates = new Map<string, string>();

  // Root agent
  for (const p of ['AGENTS.md', '.claude/CLAUDE.md']) {
    const full = resolve(root, p);
    if (existsSync(full)) {
      candidates.set(p, 'root_agent');
    }
  }

  // Generated context
  const contextDir = resolve(root, '.context');
  if (existsSync(contextDir)) {
    for (const f of walkDir(contextDir)) {
      const rel = relative(root, f);
      candidates.set(rel, 'generated_context');
    }
  }

  // Pi guidance
  for (const p of ['.pi/README.md', '.pi/settings.json']) {
    const full = resolve(root, p);
    if (existsSync(full)) {
      candidates.set(p, 'pi_guidance');
    }
  }

  // Pi extensions
  const extDir = resolve(root, '.pi/extensions');
  if (existsSync(extDir)) {
    for (const f of walkDir(extDir)) {
      if (f.endsWith('.ts')) {
        candidates.set(relative(root, f), 'pi_extensions');
      }
    }
  }

  // Pi runners
  const runnersDir = resolve(root, '.pi/runners');
  if (existsSync(runnersDir)) {
    for (const f of walkDir(runnersDir)) {
      if (f.endsWith('.gitkeep')) {
        continue;
      }
      candidates.set(relative(root, f), 'pi_runners');
    }
  }

  // Pi scripts
  const scriptsDir = resolve(root, '.pi/scripts');
  if (existsSync(scriptsDir)) {
    for (const f of walkDir(scriptsDir)) {
      if (f.endsWith('.ts')) {
        candidates.set(relative(root, f), 'pi_scripts');
      }
    }
  }

  // Agent prompts
  const promptsDir = resolve(root, '.pi/prompts');
  if (existsSync(promptsDir)) {
    for (const f of walkDir(promptsDir)) {
      if (f.endsWith('.md')) {
        candidates.set(relative(root, f), 'agent_prompts');
      }
    }
  }

  // Project skills — each <name>/SKILL.md + lint_rules.json
  const skillsDir = resolve(root, '.pi/skills');
  if (existsSync(skillsDir)) {
    for (const skillDir of readdirSync(skillsDir)) {
      const skillPath = resolve(skillsDir, skillDir);
      if (!statSync(skillPath).isDirectory()) {
        continue;
      }
      for (const f of walkDir(skillPath)) {
        const rel = relative(root, f);
        candidates.set(rel, 'pi_skills');
      }
    }
  }

  // Generated skills
  const genSkillsDir = resolve(root, '.pi/generated-skills');
  if (existsSync(genSkillsDir)) {
    for (const f of walkDir(genSkillsDir)) {
      if (f.endsWith('SKILL.md')) {
        candidates.set(relative(root, f), 'generated_skills');
      }
    }
  }

  // Agent system prompts
  const agentsDir = resolve(root, 'scripts/src/lib/agents');
  if (existsSync(agentsDir)) {
    for (const f of walkDir(agentsDir)) {
      if (f.endsWith('.ts') && (f.includes('prompt_loader') || f.includes('prompt'))) {
        candidates.set(relative(root, f), 'agent_system_prompts');
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

const hasValidExemption = (manifest: Manifest, path: string): boolean => {
  const exemption = manifest.exemptions[path];
  return typeof exemption?.reason === 'string' && exemption.reason.trim().length > 0;
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
    if (manifest.entries[path]?.active === true) {
      continue;
    }
    if (hasValidExemption(manifest, path)) {
      continue;
    }
    if (manifest.entries[path]) {
      errors.push(`Discovered active file has an inactive manifest entry: ${path}`);
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

type ReferenceRegistries = {
  readonly herdrActions: ReadonlySet<string>;
  readonly services: ReadonlySet<string>;
  readonly stageActions: ReadonlySet<string>;
};

const quotedValues = (source: string): Set<string> =>
  new Set(Array.from(source.matchAll(/['"]([\w-]+)['"]/g), (match) => match[1]));

const loadReferenceRegistries = (): ReferenceRegistries => {
  const contractPipeline = readFileSync(
    resolve(ROOT, '.pi/extensions/contract_pipeline.ts'),
    'utf-8',
  );
  const herdrExtension = readFileSync(
    resolve(ROOT, '.pi/extensions/herdr_orchestrator.ts'),
    'utf-8',
  );
  const stageActions = new Set(
    Array.from(
      contractPipeline.matchAll(/defineAction\s*\(\s*\{\s*action:\s*['"]([\w-]+)['"]/g),
      (match) => match[1],
    ),
  );
  const herdrTool = herdrExtension.match(
    /name:\s*['"]herdr_session['"][\s\S]*?action:\s*Type\.String\s*\(\s*\{\s*enum:\s*\[([^\]]+)\]/,
  );

  return {
    stageActions,
    herdrActions: quotedValues(herdrTool?.[1] ?? ''),
    services: new Set(KNOWN_SERVICES),
  };
};

const lineAt = (content: string, index: number): number =>
  content.slice(0, index).split('\n').length;

const checkStageReferences = (options: {
  content: string;
  errors: string[];
  path: string;
  registry: ReadonlySet<string>;
}): void => {
  const patterns = [
    /\bcontract_stage\s*\(\s*\{[^}]*?\baction\s*:\s*['"]([^'"]+)['"]/gs,
    /`contract_stage`\s+action\s+`([^`]+)`/g,
  ];
  for (const pattern of patterns) {
    for (const match of options.content.matchAll(pattern)) {
      const action = match[1];
      if (action && !options.registry.has(action)) {
        options.errors.push(
          `${options.path}:${lineAt(options.content, match.index)}: unknown contract_stage action "${action}"`,
        );
      }
    }
  }
};

const checkHerdrReferences = (options: {
  content: string;
  errors: string[];
  path: string;
  registries: ReferenceRegistries;
}): void => {
  const patterns = [
    /`herdr_session\s+([\w-]+)(?:\s+([\w-]+))?`/g,
    /^\s*(?:[-*]\s+)?herdr_session\s+([\w-]+)(?:\s+([\w-]+))?/gm,
  ];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const match of options.content.matchAll(pattern)) {
      const action = match[1];
      const service = match[2];
      const key = `${match.index}:${action}:${service ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const line = lineAt(options.content, match.index);
      if (action && !options.registries.herdrActions.has(action)) {
        options.errors.push(`${options.path}:${line}: unknown herdr_session action "${action}"`);
      }
      if (service && !options.registries.services.has(service)) {
        options.errors.push(`${options.path}:${line}: unknown herdr_session service "${service}"`);
      }
    }
  }
};

/** Resolves active guidance references against the extension and service registries. */
export const checkReferences = (options: { manifest: Manifest; root?: string }): CheckResult => {
  const errors: string[] = [];
  const root = options.root ?? ROOT;
  const registries = loadReferenceRegistries();

  // Scan discovered guidance so an inactive manifest entry cannot hide stale references.
  for (const [path] of discoverCandidates(root)) {
    if (options.manifest.entries[path]?.active !== true) {
      if (!hasValidExemption(options.manifest, path)) {
        errors.push(`${path}: discovered guidance is neither active nor explicitly exempted`);
      }
      continue;
    }
    const fullPath = resolve(root, path);
    if (!existsSync(fullPath)) {
      continue;
    }

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    checkStageReferences({ content, errors, path, registry: registries.stageActions });
    checkHerdrReferences({ content, errors, path, registries });
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

    const typeScriptResult = spawnSync(
      'tsgo',
      [
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--module',
        'Preserve',
        '--moduleResolution',
        'Bundler',
        '--target',
        'ESNext',
        '--types',
        'bun',
        examplePath,
      ],
      { cwd: ROOT, encoding: 'utf-8' },
    );
    if (typeScriptResult.status !== 0) {
      const output = `${typeScriptResult.stdout}${typeScriptResult.stderr}`.trim();
      errors.push(`${example}: TypeScript validation failed${output ? ` — ${output}` : ''}`);
    }

    const biomeResult = spawnSync('biome', ['check', examplePath], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    if (biomeResult.status !== 0) {
      const output = `${biomeResult.stdout}${biomeResult.stderr}`.trim();
      errors.push(`${example}: Biome validation failed${output ? ` — ${output}` : ''}`);
    }

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
  const errors: string[] = [];

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

  const originalContent = readFileSync(contextPath, 'utf-8');
  const normalize = (content: string): string =>
    content
      .split('\n')
      .filter((line) => !line.startsWith('> Generated:'))
      .join('\n');
  let firstOutput = '';
  let secondOutput = '';

  try {
    for (const run of [1, 2]) {
      const result = spawnSync(process.execPath, ['run', generatorPath], {
        cwd: ROOT,
        encoding: 'utf-8',
      });
      if (result.status !== 0) {
        const output = `${result.stdout}${result.stderr}`.trim();
        errors.push(`generate_context.ts run ${run} failed${output ? ` — ${output}` : ''}`);
        break;
      }
      const generated = readFileSync(contextPath, 'utf-8');
      if (run === 1) {
        firstOutput = normalize(generated);
      } else {
        secondOutput = normalize(generated);
      }
    }

    if (errors.length === 0 && firstOutput !== secondOutput) {
      errors.push('generate_context.ts produced different normalized output across two runs');
    }
  } catch (error) {
    errors.push(`Generator reproducibility check failed: ${String(error)}`);
  } finally {
    try {
      writeFileSync(contextPath, originalContent, 'utf-8');
    } catch (error) {
      errors.push(`Failed to restore original .context/CONTEXT.md: ${String(error)}`);
    }
  }

  const stableHash = createHash('sha256').update(firstOutput).digest('hex');

  return {
    label: 'Generator reproducibility (AC-5)',
    passed: errors.length === 0,
    details:
      errors.length > 0
        ? errors
        : [
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
    results.push(checkReferences({ manifest }));
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

if (import.meta.main) {
  main();
}
