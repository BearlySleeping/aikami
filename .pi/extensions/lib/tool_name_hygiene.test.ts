// .pi/extensions/lib/github_cli_tool_names.test.ts
//
// Structural guard on tool names that extensions print back to the model.
//
// Background: the per-operation GitHub tools (gh_merge_pr, gh_pr_comments,
// gh_workflow_status, gh_workflow_logs) were consolidated into the five
// action-dispatch hubs (gh_pr / gh_issue / gh_project / gh_workflow /
// gh_release). The registrations were updated; the prose was not. So the tool
// told the model "You can merge this PR with: gh_merge_pr("…")" — a tool that
// cannot be resolved — after every PR create, and named two more phantoms
// after every deploy dispatch. The `contract`, `direnv` and `code_rabbit` tools
// had the same fate: model-facing instructions still said
// `contract_generate`, `direnv_add_package`, `code_rabbit_autofix`.
//
// This test reads every extension source and asserts that each tool-shaped
// token appearing inside a *runtime string literal* is either a registered
// tool or an explicitly allowlisted non-tool. It is a source scan rather than
// a behavioural test on purpose: the strings are spread across dozens of
// actions and a behavioural test only covers the ones someone remembered to
// exercise — which is precisely how the original regression survived.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXTENSIONS_DIR = resolve(import.meta.dir, '..');

/**
 * Tool-shaped tokens that are NOT pi tools and must never be "fixed" into
 * tool syntax.
 *
 * - `contract_stage_complete` / `contract_review_decision` are protocol verbs
 *   of the contract pipeline itself (see
 *   scripts/src/lib/agents/contract_pipeline/stage_runner.ts). The pipeline
 *   prompts tell a worker to call them; they are not pi tool names.
 * - `contract_pipeline` is a module path and pipeline stage name.
 * - `contract_factory` is the generator signature stamped into generated
 *   contract markdown — provenance, not an instruction.
 * - `run_guards` is a script filename
 *   (scripts/src/lib/ops/run_guards.ts), not a tool.
 */
const ALLOWED_NON_TOOLS = new Set([
  'contract_stage_complete',
  'contract_review_decision',
  'contract_pipeline',
  'contract_factory',
  'run_guards',
]);

/** Prefix families whose members look like tool names (`gh_*`, `code_rabbit_*`, …). */
const TOOL_TOKEN =
  /\b((?:gh|code_rabbit|contract|direnv|browser|vision|subagent|herdr|bg|moon|task_pr)_[a-z0-9_]+)\b/g;

const sourceFiles = (): { file: string; source: string }[] =>
  readdirSync(EXTENSIONS_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ file: name, source: readFileSync(join(EXTENSIONS_DIR, name), 'utf8') }));

const allSources = sourceFiles();

/** Tool names registered by these extensions (`name: 'gh_pr'` and friends). */
const REGISTERED_TOOLS = new Set<string>();
for (const { source } of allSources) {
  for (const match of source.matchAll(/name:\s*'([a-z][a-z0-9_]{2,})'/g)) {
    REGISTERED_TOOLS.add(match[1] as string);
  }
}

/**
 * String + template literals in a source file, with comments stripped.
 *
 * Comments are removed first because files legitimately *name* the removed
 * tools when explaining this very regression, and that prose must not fail the
 * test.
 */
const stringLiterals = (source: string): string[] => {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [
    ...withoutComments.matchAll(/`(?:[^`\\]|\\.)*`/g),
    ...withoutComments.matchAll(/'(?:[^'\\\n]|\\.)*'/g),
    ...withoutComments.matchAll(/"(?:[^"\\\n]|\\.)*"/g),
  ].map((match) => match[0]);
};

/** Every tool-shaped token in runtime strings, with where it came from. */
const toolMentions = (): { file: string; token: string; literal: string }[] =>
  allSources.flatMap(({ file, source }) =>
    stringLiterals(source).flatMap((literal) =>
      [...literal.matchAll(TOOL_TOKEN)].map((match) => ({
        file,
        token: match[1] as string,
        literal: literal.length > 120 ? `${literal.slice(0, 120)}…` : literal,
      })),
    ),
  );

const phantoms = (): { file: string; token: string; literal: string }[] =>
  toolMentions().filter(
    ({ token }) => !REGISTERED_TOOLS.has(token) && !ALLOWED_NON_TOOLS.has(token),
  );

describe('pi extension tool-name hygiene', () => {
  test('the registration scan found the known hubs (guards against a broken regex)', () => {
    // If this fails the phantoms check below is vacuously green.
    for (const expected of ['gh_pr', 'gh_issue', 'gh_project', 'gh_workflow', 'gh_release']) {
      expect(REGISTERED_TOOLS.has(expected)).toBe(true);
    }
  });

  test('the scanner sees a meaningful number of tool mentions', () => {
    // Guards the other direction: a scanner that matches nothing would let the
    // whole suite pass for the wrong reason.
    expect(toolMentions().length).toBeGreaterThan(20);
  });

  test('no runtime string names a tool that is neither registered nor allowlisted', () => {
    const offenders = phantoms();

    expect(offenders.map(({ file, token, literal }) => ({ file, token, literal }))).toEqual([]);
  });

  test('the merge hint names a real tool and its action', () => {
    // The exact sentence that regressed: `You can merge this PR with:
    // `gh_merge_pr("…")`` told the model to call a tool that does not exist.
    const mergeHints = toolMentions().filter(({ literal }) =>
      literal.includes('You can merge this PR with'),
    );

    expect(mergeHints.length).toBeGreaterThan(0);
    for (const { token, literal } of mergeHints) {
      expect(REGISTERED_TOOLS.has(token)).toBe(true);
      expect(literal).toContain('action');
      expect(literal).toContain('merge');
    }
  });

  test('deploy hints name gh_workflow, not the removed gh_workflow_* tools', () => {
    const deployHints = stringLiterals(allSources.map((s) => s.source).join('\n')).filter(
      (literal) => /Watch with:|Logs with:/.test(literal),
    );

    expect(deployHints.length).toBeGreaterThan(0);
    for (const literal of deployHints) {
      expect(literal).toContain('gh_workflow');
      expect(literal).not.toMatch(/\bgh_workflow_(status|logs|run)\b/);
    }
  });

  test('the vision guard matches the registered browser tool, not a pre-rename name', () => {
    // `browser_screenshot` was the tool name before the action-dispatch
    // consolidation; the screenshot-enrichment branch compared against it and
    // therefore never fired.
    const source = allSources.find((entry) => entry.file === 'vision_guard.ts')?.source ?? '';

    expect(source).toContain("event.toolName !== 'browser'");
    expect(source).not.toContain("'browser_screenshot'");
  });
});
