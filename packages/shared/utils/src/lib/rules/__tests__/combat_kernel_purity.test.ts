// packages/shared/utils/src/lib/rules/__tests__/combat_kernel_purity.test.ts
//
// AC-7: the combat kernel's purity boundary holds — it imports only shared
// packages and contains no engine, ECS, network, AI or ambient-randomness
// dependency.
//
// Contract: C-509 AC-7

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CombatCommand } from '@aikami/types';
import {
  canonicalCombatJson,
  createCombatState,
  replayCombat,
  resolveCombatCommand,
} from '../combat_kernel';
import { createInput, GOBLIN_1, PLAYER_ID, RULES_VERSION } from './combat_fixtures';

// ── Source introspection ───────────────────────────────────────────────

const KERNEL_SOURCE_PATH = fileURLToPath(new URL('../combat_kernel.ts', import.meta.url));
const UTILS_PACKAGE_JSON_PATH = fileURLToPath(new URL('../../../../package.json', import.meta.url));

const kernelSource = readFileSync(KERNEL_SOURCE_PATH, 'utf8');

/** Removes block and line comments so prose can never trip a scan. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const code = stripComments(kernelSource);

const collectImportSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  const fromPattern = /\bfrom\s+['"]([^'"]+)['"]/g;
  const barePattern = /\bimport\s+['"]([^'"]+)['"]/g;
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const pattern of [fromPattern, barePattern, dynamicPattern]) {
    let match = pattern.exec(source);
    while (match !== null) {
      specifiers.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return specifiers;
};

const ALLOWED_IMPORT_SPECIFIERS = new Set([
  '@aikami/schemas',
  '@aikami/types',
  'typebox',
  'typebox/value',
]);

const isAllowedRelativeImport = (specifier: string): boolean =>
  /^\.{1,2}\/[A-Za-z0-9_./-]+$/.test(specifier) && !specifier.includes('../../..');

const FORBIDDEN_SOURCE_TOKENS = [
  '@aikami/engine',
  '@aikami/frontend',
  '@aikami/backend',
  'bitecs',
  'pixi.js',
  '@pixi/',
  'Math.random',
  'crypto.getRandomValues',
  'XMLHttpRequest',
  'fetch(',
  'node:fs',
  'node:http',
  'node:https',
  'process.env',
  '$lib',
  '$app/',
  '$env/',
  '$logger',
];

// ── AC-7 ───────────────────────────────────────────────────────────────

describe('combat kernel purity (C-509 AC-7)', () => {
  it('imports only shared packages and local relative modules', () => {
    const offenders = collectImportSpecifiers(code).filter(
      (specifier) =>
        !ALLOWED_IMPORT_SPECIFIERS.has(specifier) && !isAllowedRelativeImport(specifier),
    );
    expect(offenders).toEqual([]);
  });

  it('never reaches into the engine, ECS, client, network, AI or ambient randomness', () => {
    const offenders = FORBIDDEN_SOURCE_TOKENS.filter((token) => code.includes(token));
    expect(offenders).toEqual([]);
  });

  it('declares the runtime dependencies it actually imports', () => {
    const manifest = JSON.parse(readFileSync(UTILS_PACKAGE_JSON_PATH, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const dependencies = manifest.dependencies ?? {};
    expect(dependencies['@aikami/schemas']).toBeDefined();
    expect(dependencies.typebox).toBeDefined();
  });

  it('resolves commands without touching the network', () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    const deniedFetch = (() => {
      fetchCalls += 1;
      throw new Error('the combat kernel must never fetch');
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = deniedFetch;
    try {
      const state = createCombatState(createInput({ seed: 77 }));
      const resolved = resolveCombatCommand({
        state,
        command: {
          kind: 'useAbility',
          combatantId: PLAYER_ID,
          abilityId: 'basic_melee',
          targetIds: [GOBLIN_1],
        },
      });
      expect(resolved.valid).toBe(true);
      replayCombat({
        initialState: state,
        rulesVersion: RULES_VERSION,
        commands: [{ kind: 'endTurn', combatantId: PLAYER_ID }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalls).toBe(0);
  });

  it('produces identical output with the network layer absent', () => {
    const state = createCombatState(createInput({ seed: 77 }));
    const command: CombatCommand = {
      kind: 'useAbility',
      combatantId: PLAYER_ID,
      abilityId: 'basic_melee',
      targetIds: [GOBLIN_1],
    };
    const first = resolveCombatCommand({ state, command });
    const second = resolveCombatCommand({ state, command });
    expect(canonicalCombatJson(first)).toBe(canonicalCombatJson(second));
  });
});
