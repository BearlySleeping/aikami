// Smoke test: load every extension with a stand-in pi and assert what it
// registers. This is the end-to-end guard for the namespace collapse — a
// truncated or mis-grouped extension shows up here as a missing action.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// contract_stage only registers inside a pipeline worker (see lib/gating.ts).
// Set the role so the smoke test sees the complete tool surface; the gating
// behaviour itself is covered by gating.test.ts.
beforeAll(() => {
  process.env.CONTRACT_PIPELINE_ROLE = 'implementer';
});

afterAll(() => {
  delete process.env.CONTRACT_PIPELINE_ROLE;
});

const EXTENSIONS_DIR = join(import.meta.dir, '..');

type CapturedTool = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
};

type Capture = {
  tools: CapturedTool[];
  events: string[];
};

/** Loads one extension against a recording stand-in for the pi API. */
const loadExtension = async (file: string): Promise<Capture> => {
  const capture: Capture = { tools: [], events: [] };

  const pi = {
    registerTool: (tool: CapturedTool) => capture.tools.push(tool),
    on: (event: string) => capture.events.push(event),
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    getFlag: () => undefined,
    registerMessageRenderer: () => {},
    registerMarkdownTransformer: () => {},
    registerEntryRenderer: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    exec: async () => ({ code: 0, stdout: '', stderr: '', killed: false }),
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getCommands: () => [],
  };

  const module = await import(join(EXTENSIONS_DIR, file));
  const factory = module.default as (api: unknown) => void | Promise<void>;
  await factory(pi);
  return capture;
};

const extensionFiles = readdirSync(EXTENSIONS_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort();

describe('extension registration', () => {
  test('every extension file exports a default factory', () => {
    expect(extensionFiles.length).toBeGreaterThan(10);
  });

  test('every extension loads and registers without throwing', async () => {
    for (const file of extensionFiles) {
      await loadExtension(file);
    }
  });

  test('no two extensions register the same tool name', async () => {
    const seen = new Map<string, string>();
    for (const file of extensionFiles) {
      for (const tool of (await loadExtension(file)).tools) {
        expect(seen.has(tool.name)).toBe(false);
        seen.set(tool.name, file);
      }
    }
  });

  test('every registered tool has a name, label and description', async () => {
    for (const file of extensionFiles) {
      for (const tool of (await loadExtension(file)).tools) {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(tool.label.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
      }
    }
  });

  test('no tool carries promptGuidelines — they are always-on prompt cost', async () => {
    for (const file of extensionFiles) {
      for (const tool of (await loadExtension(file)).tools) {
        expect(tool.promptGuidelines).toBeUndefined();
      }
    }
  });

  // ── Namespace shape ──────────────────────────────────────────────

  const expectedActions: Record<string, string[]> = {
    gh_pr: ['create', 'list', 'view', 'status', 'merge', 'close', 'edit', 'ready', 'comments'],
    gh_issue: ['list', 'create', 'close', 'reopen', 'edit', 'view'],
    gh_project: ['list', 'view', 'item_add', 'item_set', 'item_get'],
    gh_workflow: ['run', 'status', 'logs', 'deploy'],
    gh_release: ['list', 'view'],
    contract: [
      'backlog',
      'generate',
      'workspace_create',
      'workspace_checkpoint',
      'workspace_complete',
      'workspace_list',
    ],
    contract_stage: ['complete', 'review_decision', 'reconcile', 'log_failure'],
    browser: ['inspect', 'screenshot', 'console', 'network', 'lighthouse'],
    direnv: ['status', 'switch_mode', 'add_package', 'add_secret'],
    code_rabbit: ['autofix', 'findings', 'wait'],
    bg: ['run', 'wait', 'status', 'list', 'kill'],
  };

  test('each namespace advertises exactly its expected actions', async () => {
    const byName = new Map<string, CapturedTool>();
    for (const file of extensionFiles) {
      for (const tool of (await loadExtension(file)).tools) {
        byName.set(tool.name, tool);
      }
    }

    for (const [name, actions] of Object.entries(expectedActions)) {
      const tool = byName.get(name);
      expect(tool, `namespace ${name} is not registered`).toBeDefined();

      // The dispatcher lists its actions in the description as "• <action> — ".
      const listed = [...(tool?.description ?? '').matchAll(/^• ([a-z_]+) —/gm)].map((m) => m[1]);
      expect(listed, `namespace ${name}`).toEqual(actions);
    }
  });

  test('the 26 former gh_* tools are now 5 namespaces', async () => {
    const ghTools = (await loadExtension('github_cli.ts')).tools;
    expect(ghTools.map((t) => t.name)).toEqual([
      'gh_pr',
      'gh_issue',
      'gh_project',
      'gh_workflow',
      'gh_release',
    ]);
  });
});
