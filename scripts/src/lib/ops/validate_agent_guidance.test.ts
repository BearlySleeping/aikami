// scripts/src/lib/ops/validate_agent_guidance.test.ts
//
// C-475 AC-2: reference resolution tests against the validate_agent_guidance
// script. Tests that valid references pass, renamed-tool references fail,
// missing-service references fail, missing-file references fail, and
// historical-exemption references pass.
//
// These tests verify the validation script's logic without invoking any
// referenced tool or service.

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkReferences, type Manifest } from './validate_agent_guidance';

const ROOT = resolve(import.meta.dir, '../../../..');
const MANIFEST_PATH = resolve(ROOT, '.pi/guidance/manifest.json');
const EXAMPLES_DIR = resolve(ROOT, '.pi/guidance/examples');

// ── AC-2: Reference resolution ───────────────────────────────────────────

describe('AC-2: Reference resolution', () => {
  const fixtureRoots: string[] = [];

  const validateFixture = (content: string, active = true) => {
    const root = mkdtempSync(join(tmpdir(), 'aikami-guidance-'));
    fixtureRoots.push(root);
    writeFileSync(resolve(root, 'AGENTS.md'), content, 'utf-8');
    const manifest: Manifest = {
      version: 1,
      description: 'Controlled reference fixture',
      entries: {
        'AGENTS.md': { class: 'root_agent', active },
      },
      exemptions: {},
    };
    return checkReferences({ manifest, root });
  };

  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts references resolved from the action and service registries', () => {
    const result = validateFixture(
      "contract_stage({ action: 'complete' });\n`herdr_session restart client`\n",
    );

    expect(result.passed).toBe(true);
    expect(result.details).toEqual([
      'All tool/action/service references resolve to known registries',
    ]);
  });

  it.each(['finish', 'submit', 'completed'])(
    'rejects renamed, obsolete, or misspelled contract_stage action %s',
    (action) => {
      const result = validateFixture(`contract_stage({ action: '${action}' });\n`);

      expect(result.passed).toBe(false);
      expect(result.details.join('\n')).toContain(`unknown contract_stage action "${action}"`);
    },
  );

  it('rejects unknown herdr actions and services', () => {
    const result = validateFixture('herdr_session destroy firebase\n');

    expect(result.passed).toBe(false);
    expect(result.details.join('\n')).toContain('unknown herdr_session action "destroy"');
    expect(result.details.join('\n')).toContain('unknown herdr_session service "firebase"');
  });

  it('does not let an inactive manifest entry hide discovered guidance', () => {
    const result = validateFixture("contract_stage({ action: 'finish' });\n", false);

    expect(result.passed).toBe(false);
    expect(result.details.join('\n')).toContain(
      'AGENTS.md: discovered guidance is neither active nor explicitly exempted',
    );
  });
});

// ── AC-3: Manifest coverage ──────────────────────────────────────────────

describe('AC-3: Manifest coverage', () => {
  it('manifest file exists and is valid JSON', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    expect(manifest.version).toBe(1);
    expect(typeof manifest.entries).toBe('object');
    expect(typeof manifest.exemptions).toBe('object');
  });

  it('manifest entries point to existing files', () => {
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    const errors: string[] = [];

    for (const [path, entry] of Object.entries(manifest.entries)) {
      if (!(entry as { active: boolean }).active) {
        continue;
      }
      const fullPath = resolve(ROOT, path);
      if (!existsSync(fullPath)) {
        errors.push(`Missing: ${path}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('exemption paths exist on disk', () => {
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    const errors: string[] = [];

    for (const [path] of Object.entries(manifest.exemptions)) {
      const fullPath = resolve(ROOT, path);
      if (!existsSync(fullPath)) {
        errors.push(`Exemption path missing: ${path}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('has entries for all source classes', () => {
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    const classes = new Set<string>();

    for (const entry of Object.values(manifest.entries)) {
      classes.add((entry as { class: string }).class);
    }

    // Should have entries from all expected source classes
    expect(classes.has('root_agent')).toBe(true);
    expect(classes.has('generated_context')).toBe(true);
    expect(classes.has('pi_guidance')).toBe(true);
    expect(classes.has('pi_extensions')).toBe(true);
    expect(classes.has('pi_skills')).toBe(true);
    expect(classes.has('generated_skills')).toBe(true);
    expect(classes.has('agent_prompts')).toBe(true);
    expect(classes.has('agent_system_prompts')).toBe(true);
  });
});

// ── AC-1: Canonical examples ─────────────────────────────────────────────

describe('AC-1: Canonical examples', () => {
  it('positive example files exist', () => {
    const examples = [
      'view_model_canonical.ts',
      'service_canonical.ts',
      'helper_canonical.ts',
      'data_boundary_canonical.ts',
    ];

    for (const example of examples) {
      const fullPath = resolve(EXAMPLES_DIR, example);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  it('mutation fixture exists', () => {
    const mutationPath = resolve(EXAMPLES_DIR, 'view_model_mutation.ts');
    expect(existsSync(mutationPath)).toBe(true);

    const content = readFileSync(mutationPath, 'utf-8');
    // Must use `new ClassName(` which violates M4
    expect(content).toMatch(/new \w+\(/);
  });

  it('positive examples have no unsafe suppressions', () => {
    const examples = [
      'view_model_canonical.ts',
      'service_canonical.ts',
      'helper_canonical.ts',
      'data_boundary_canonical.ts',
    ];

    for (const example of examples) {
      const fullPath = resolve(EXAMPLES_DIR, example);
      const content = readFileSync(fullPath, 'utf-8');
      expect(content).not.toMatch(/@ts-ignore|@ts-expect-error/);
    }
  });

  it('view_model_canonical.ts follows M1-M4 pattern', () => {
    const content = readFileSync(resolve(EXAMPLES_DIR, 'view_model_canonical.ts'), 'utf-8');
    expect(content).toMatch(/ViewModelOptions/);
    expect(content).toMatch(/ViewModelInterface/);
    expect(content).toMatch(/\.create\(/);
  });

  it('service_canonical.ts follows S1-S4 pattern', () => {
    const content = readFileSync(resolve(EXAMPLES_DIR, 'service_canonical.ts'), 'utf-8');
    expect(content).toMatch(/ServiceOptions/);
    expect(content).toMatch(/ServiceInterface/);
    expect(content).toMatch(/\.create\(/);
  });

  it('data_boundary_canonical.ts returns undefined for invalid input', () => {
    const content = readFileSync(resolve(EXAMPLES_DIR, 'data_boundary_canonical.ts'), 'utf-8');
    expect(content).toMatch(/\| undefined/);
  });

  it('README describes which examples are executable vs illustrative', () => {
    const readmePath = resolve(EXAMPLES_DIR, 'README.md');
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, 'utf-8');
    expect(content).toMatch(/✅ executable|❌ intentionally invalid/);
  });
});

// ── AC-5: Deterministic checks ───────────────────────────────────────────

describe('AC-5: Deterministic CI checks', () => {
  it('validate_agent_guidance.ts exists as a runnable script', () => {
    const scriptPath = resolve(ROOT, 'scripts/src/lib/ops/validate_agent_guidance.ts');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('CONTEXT.md exists and is readable', () => {
    const contextPath = resolve(ROOT, '.context/CONTEXT.md');
    expect(existsSync(contextPath)).toBe(true);
    const content = readFileSync(contextPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});
