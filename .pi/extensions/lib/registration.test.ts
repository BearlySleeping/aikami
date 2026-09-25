// Smoke test: load every extension with a stand-in pi and assert what it
// registers. This is the end-to-end guard for the namespace collapse — a
// truncated or mis-grouped extension shows up here as a missing action.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
import routeGuardExtension from '../route_guard.ts';

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

type CapturedToolCallHandler = (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined>;

const createFakeExtensionApi = () => {
  let handler: CapturedToolCallHandler | undefined;
  let registeredEvent: string | undefined;

  routeGuardExtension({
    on: (eventName, capturedHandler) => {
      registeredEvent = eventName;
      handler = capturedHandler;
      return () => {
        if (handler === capturedHandler) {
          handler = undefined;
        }
      };
    },
  });

  if (registeredEvent !== 'tool_call') {
    throw new Error(`expected tool_call registration, received ${registeredEvent ?? 'nothing'}`);
  }

  return {
    dispatch: async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
      const capturedHandler = handler;
      if (!capturedHandler) {
        throw new Error('tool_call handler was not registered');
      }
      return capturedHandler(event);
    },
  };
};

const createBashEvent = (command: string): ToolCallEvent => ({
  type: 'tool_call',
  toolCallId: 'route-guard-test',
  toolName: 'bash',
  input: { command },
});

const BLOCKED_BASH_COMMANDS = [
  ['mkdir', String.raw`mkdir -p 'src/routes/\(dev\)'`],
  ['assignment before mkdir', String.raw`MODE=test mkdir -p 'src/routes/\(dev\)'`],
  ['quoted path with greater-than', String.raw`mkdir 'src/routes/\(dev\)/a>b'`],
  ['touch', String.raw`touch 'src/routes/\(sandbox\)/page.svelte'`],
  ['mv source', String.raw`mv 'src/routes/\(dev\)' 'src/routes/(dev)'`],
  ['cp destination', String.raw`cp source.svelte 'src/routes/\(dev\)/source.svelte'`],
  ['mkdir after stderr descriptor redirect', String.raw`mkdir safe 2>&1 'src/routes/\(dev\)'`],
  ['command after separator', String.raw`grep route >/dev/null; mkdir 'src/routes/\(dev\)'`],
] as const;

const ALLOWED_BASH_COMMANDS = [
  ['unquoted shell-safe path', String.raw`mkdir -p src/routes/\(dev\)`],
  ['grep regex', String.raw`grep -R '\\(dev\\)' src/routes`],
  ['grep alternation containing a verb', String.raw`grep -E 'foo|mkdir' 'src/routes/\(dev\)'`],
  ['sed inspection', String.raw`sed -n '/\(dev\)/p' 'src/routes/\(dev\)/page.svelte' 2>/dev/null`],
  [
    'sed expression containing separators',
    String.raw`sed -n '/touch && cp/p' 'src/routes/\(dev\)/page.svelte'`,
  ],
  [
    'sed in-place inspection',
    String.raw`sed -i 's/\\(dev\\)/(dev)/' 'src/routes/\(dev\)/page.svelte'`,
  ],
  [
    'grep and sed pipeline',
    String.raw`grep -R '\\(dev\\)' src/routes | sed -n '/\\(sandbox\\)/p' 2>&1`,
  ],
  ['tee', String.raw`tee 'src/routes/\(dev\)/diagnostic.txt'`],
  ['escaped filename outside route tree', String.raw`mkdir -p 'docs/\(dev\)'`],
  ['stdout redirection', String.raw`printf '%s\n' route > 'src/routes/\(dev\)/diagnostic.txt'`],
  ['mkdir stderr redirection', String.raw`mkdir -p src/routes/(dev) 2> 'logs/\(dev\)'`],
  ['mkdir noclobber redirection', String.raw`mkdir safe >| 'logs/\(dev\)'`],
  ['escaped group in separate argument', String.raw`mkdir 'src/routes/(dev)' '\(sandbox\)'`],
  ['verb text in another command', String.raw`echo "run touch 'src/routes/\(dev\)'"`],
  [
    'target verb without an escaped path',
    String.raw`mkdir -p 'src/routes/(dev)' && touch src/routes/\(dev\)/page.svelte`,
  ],
] as const;

describe('route guard bash policy', () => {
  test.each(BLOCKED_BASH_COMMANDS)('blocks escaped paths passed to %s', async (_label, command) => {
    const { dispatch } = createFakeExtensionApi();
    const result = await dispatch(createBashEvent(command));

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('backslash-escaped route group');
  });

  test.each(ALLOWED_BASH_COMMANDS)('allows %s', async (_label, command) => {
    const { dispatch } = createFakeExtensionApi();
    const result = await dispatch(createBashEvent(command));

    expect(result).toBeUndefined();
  });
});

describe('route guard file-path policy', () => {
  test('normalizes an escaped route group in a path-tool argument', async () => {
    const { dispatch } = createFakeExtensionApi();
    const input = { path: String.raw`src/routes/\(dev\)/page.svelte` };
    const event: ToolCallEvent = {
      type: 'tool_call',
      toolCallId: 'route-guard-path-test',
      toolName: 'read',
      input,
    };

    await dispatch(event);

    expect(input.path).toBe('src/routes/(dev)/page.svelte');
  });

  test('leaves escaped parentheses in an ordinary filename untouched', async () => {
    const { dispatch } = createFakeExtensionApi();
    const input = { path: String.raw`docs/\(draft\)/notes.md` };
    const event: ToolCallEvent = {
      type: 'tool_call',
      toolCallId: 'route-guard-non-route-test',
      toolName: 'read',
      input,
    };

    await dispatch(event);

    expect(input.path).toBe(String.raw`docs/\(draft\)/notes.md`);
  });
});

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
    contract_stage: ['complete', 'review_decision', 'validate', 'reconcile', 'log_failure'],
    browser: ['inspect', 'screenshot', 'console', 'network', 'lighthouse'],
    direnv: ['status', 'switch_mode', 'add_package', 'add_secret'],
    code_rabbit: ['autofix', 'findings', 'wait'],
    bg: ['run', 'wait', 'status', 'list', 'kill'],
    subagent: [
      'spawn',
      'wait',
      'wait_all',
      'status',
      'list',
      'result',
      'message',
      'kill',
      'cleanup',
      'models',
    ],
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
