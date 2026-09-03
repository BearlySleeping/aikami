// scripts/src/lib/ci/diagnostics.test.ts
//
// Fixtures here are verbatim excerpts from a real failing run of this repo's
// gate (actions/runs/33788609836) plus captured output from each tool run
// standalone. Hand-written approximations would drift from what moon actually
// prints, which is exactly the failure mode this parser exists to prevent.

import { describe, expect, test } from 'bun:test';
import { parseCiLog, parseProjectRoots } from './diagnostics.ts';

const PROJECT_ROOTS = {
  client: 'apps/frontend/client',
  schemas: 'packages/shared/schemas',
  types: 'packages/shared/types',
  'frontend-engine': 'packages/frontend/engine',
  scripts: 'scripts',
  e2e: 'apps/e2e',
};

const parse = (log: string) => parseCiLog({ log, projectRoots: PROJECT_ROOTS });

describe('parseProjectRoots', () => {
  test('reads the flat projects map and stops at the next top-level key', () => {
    const roots = parseProjectRoots(
      [
        'projects:',
        '  pi: ".pi"',
        '  # a comment',
        '  client: "apps/frontend/client"',
        "  schemas: 'packages/shared/schemas'",
        '',
        'vcs:',
        '  provider: "github"',
      ].join('\n'),
    );
    expect(roots).toEqual({
      pi: '.pi',
      client: 'apps/frontend/client',
      schemas: 'packages/shared/schemas',
    });
    expect(roots.provider).toBeUndefined();
  });
});

describe('parseCiLog — tsc', () => {
  test('resolves a project-relative tsc path against the target project root', () => {
    const { diagnostics } = parse(
      "                 types:typecheck | src/index.ts(36,1): error TS2308: Module './lib/ai/index.js' has already exported a member named 'AiProvider'.",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      target: 'types:typecheck',
      tool: 'tsc',
      file: 'packages/shared/types/src/index.ts',
      line: 36,
      col: 1,
      code: 'TS2308',
    });
  });

  test('walks `..` out of the project root', () => {
    const { diagnostics } = parse(
      '            schemas:typecheck | ../types/src/index.ts(36,1): error TS2308: Ambiguous re-export.',
    );
    expect(diagnostics[0]?.file).toBe('packages/shared/types/src/index.ts');
  });
});

describe('parseCiLog — svelte-check / guards', () => {
  test('parses the file:line:col em-dash message shape with a trailing code', () => {
    const { diagnostics } = parse(
      "  client:typecheck | ❌ apps/frontend/client/src/lib/services/config/config_migration.ts:110:20 — Argument of type '{ id: string; }' is not assignable to parameter of type 'AiProvider'. [2345]",
    );
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      file: 'apps/frontend/client/src/lib/services/config/config_migration.ts',
      line: 110,
      col: 20,
      code: 'TS2345',
      tool: 'svelte-check',
    });
    expect(diagnostics[0]?.message).not.toContain('[2345]');
  });

  test('absorbs indented continuation lines into the parent message', () => {
    const { diagnostics } = parse(
      [
        "  client:typecheck | ❌ apps/frontend/client/src/lib/services/config/config_migration.ts:258:50 — Property 'id' does not exist on type 'AiProvider'.",
        "  client:typecheck |    Property 'id' does not exist on type '\"openai\"'. [2339]",
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toBe(
      "Property 'id' does not exist on type 'AiProvider'.\nProperty 'id' does not exist on type '\"openai\"'.",
    );
    expect(diagnostics[0]?.code).toBe('TS2339');
  });

  test('reads a workflow-command annotation, unescaping the newline escape', () => {
    const { diagnostics } = parse(
      '  client:typecheck | ::error file=src/lib/services/config/config_service.svelte.ts,line=319,col=13,title=svelte-check::Type A%0A  is not assignable to type B.',
    );
    expect(diagnostics[0]).toMatchObject({
      file: 'apps/frontend/client/src/lib/services/config/config_service.svelte.ts',
      line: 319,
      col: 13,
      tool: 'svelte-check',
    });
    expect(diagnostics[0]?.message).toContain('\n');
  });

  test('parses the mvvm/service guard `file:line [rule] message` shape', () => {
    const { diagnostics } = parse(
      '  scripts:guard-mvvm-conventions |       apps/frontend/client/src/lib/views/start/start_view.svelte:42 [no-logic-in-view] Move this to the view model.',
    );
    expect(diagnostics[0]).toMatchObject({
      tool: 'guard',
      file: 'apps/frontend/client/src/lib/views/start/start_view.svelte',
      line: 42,
      code: 'no-logic-in-view',
      message: 'Move this to the view model.',
    });
  });
});

describe('parseCiLog — biome', () => {
  // `--reporter=concise` is what the PR gate runs (AIKAMI_BIOME_REPORTER),
  // threaded through moon task args in .moon/tasks/all.yml.
  test('parses a concise-reporter line with a location', () => {
    const { diagnostics } = parse(
      '  frontend-engine:lint | × src/entities/create_npc.ts:1:17: lint/suspicious/noExplicitAny: Unexpected any. Specify a different type.',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      tool: 'biome',
      file: 'packages/frontend/engine/src/entities/create_npc.ts',
      line: 1,
      col: 17,
      code: 'lint/suspicious/noExplicitAny',
      message: 'Unexpected any. Specify a different type.',
    });
  });

  test('treats a concise `!` line as a warning', () => {
    const { diagnostics, failedTargets } = parse(
      '  frontend-engine:lint | ! src/a.ts:2:2: lint/style/useConst: This let declares a variable that is only assigned once.',
    );
    expect(diagnostics[0]?.severity).toBe('warning');
    expect(failedTargets).toEqual([]);
  });

  // A format violation is whole-file: biome emits no line:col for it.
  test('parses a concise format diagnostic that has no line or column', () => {
    const { diagnostics } = parse(
      '  frontend-engine:format | × src/a.ts: format: Formatter would have printed the following content:',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      tool: 'biome',
      file: 'packages/frontend/engine/src/a.ts',
      code: 'format',
    });
    expect(diagnostics[0]?.line).toBeUndefined();
    // biome's concise reporter drops the diff its message points at, so the
    // raw text ends on a dangling colon. Report something actionable instead.
    expect(diagnostics[0]?.message).toBe(
      'File is not formatted. Run `bun run fix` to apply the formatter.',
    );
  });

  test('pairs a default-reporter header with the message line that follows it', () => {
    const { diagnostics } = parse(
      [
        '  frontend-engine:lint | src/entities/create_npc.ts:1:17 lint/suspicious/noExplicitAny ━━━━━━━━',
        '  frontend-engine:lint | ',
        '  frontend-engine:lint |   × Unexpected any. Specify a different type.',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      tool: 'biome',
      file: 'packages/frontend/engine/src/entities/create_npc.ts',
      line: 1,
      col: 17,
      code: 'lint/suspicious/noExplicitAny',
      message: 'Unexpected any. Specify a different type.',
    });
  });

  test('treats a bang-prefixed message as a warning', () => {
    const { diagnostics } = parse(
      [
        '  frontend-engine:lint | src/entities/create_npc.ts:2:2 lint/style/useConst  FIXABLE  ━━━━━',
        '  frontend-engine:lint |   ! This let declares a variable that is only assigned once.',
      ].join('\n'),
    );
    expect(diagnostics[0]?.severity).toBe('warning');
  });
});

describe('parseCiLog — bun test', () => {
  test('attaches the error message and stack location to the failing test', () => {
    const { diagnostics } = parse(
      [
        '  scripts:test | error: expect(received).toBe(expected)',
        '  scripts:test |       at <anonymous> (/home/runner/work/aikami/aikami/scripts/src/lib/ci/demo.test.ts:3:17)',
        '  scripts:test | (fail) adds numbers [0.14ms]',
      ].join('\n'),
    );
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      tool: 'bun test',
      file: 'scripts/src/lib/ci/demo.test.ts',
      line: 3,
      col: 17,
      code: 'test-failure',
    });
    expect(diagnostics[0]?.message).toContain('adds numbers');
    expect(diagnostics[0]?.message).toContain('expect(received).toBe(expected)');
  });
});

describe('parseCiLog — playwright', () => {
  // Verbatim from `playwright test` with the `list` reporter (CI=1), the
  // exact reporter apps/e2e/playwright.config.ts selects in CI.
  const LIST_OUTPUT = [
    '  e2e:test | Running 6 tests using 2 workers',
    '  e2e:test | ',
    '  e2e:test |   ✘  1 [client] › tests/client/game_page.spec.ts:2:5 › adds numbers correctly (4ms)',
    '  e2e:test |   ✓  5 [game] › tests/game/boot.spec.ts:8:5 › passes fine (3ms)',
    '  e2e:test | ',
    '  e2e:test |   1) [client] › tests/client/game_page.spec.ts:2:5 › adds numbers correctly ─────────────',
    '  e2e:test | ',
    '  e2e:test |     Error: expect(received).toBe(expected) // Object.is equality',
    '  e2e:test | ',
    '  e2e:test |     Expected: 3',
    '  e2e:test |     Received: 2',
    '  e2e:test | ',
    "  e2e:test |       2 | test('adds numbers correctly', () => {",
    '  e2e:test |     > 3 |   expect(1 + 1).toBe(3);',
    '  e2e:test |         |                 ^',
    '  e2e:test |         at /home/runner/work/aikami/aikami/apps/e2e/tests/client/game_page.spec.ts:3:17',
  ].join('\n');

  test('reads the numbered failure block, not the progress line above it', () => {
    const { diagnostics } = parse(LIST_OUTPUT);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      tool: 'playwright',
      file: 'apps/e2e/tests/client/game_page.spec.ts',
      line: 2,
      col: 5,
      code: 'client',
    });
  });

  test('joins the test title with the Error line that follows it', () => {
    const { diagnostics } = parse(LIST_OUTPUT);
    expect(diagnostics[0]?.message).toBe(
      'adds numbers correctly — Error: expect(received).toBe(expected) // Object.is equality',
    );
  });

  test('does not absorb the code frame or the stack line into the message', () => {
    const { diagnostics } = parse(LIST_OUTPUT);
    expect(diagnostics[0]?.message).not.toContain('Expected: 3');
    expect(diagnostics[0]?.message).not.toContain('at /home/runner');
  });

  test('unions the projects when one spec fails in several of them', () => {
    const { diagnostics } = parse(
      [
        '  e2e:test |   1) [client] › tests/a.spec.ts:2:5 › shared title ────────',
        '  e2e:test |     Error: boom',
        '  e2e:test | ',
        '  e2e:test |   2) [game] › tests/a.spec.ts:2:5 › shared title ────────',
        '  e2e:test |     Error: boom',
      ].join('\n'),
    );
    // One broken test at one location — but the reader still needs to see
    // that it broke in `game` as well, so the projects merge into the code
    // instead of the second copy being dropped.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('client, game');
  });
});

describe('parseCiLog — failed targets and dedupe', () => {
  test('records a target that failed without emitting any diagnostic', () => {
    const { diagnostics, failedTargets } = parse(
      '  local-stack:build | error: script "build" exited with code 1',
    );
    expect(diagnostics).toHaveLength(0);
    expect(failedTargets).toEqual(['local-stack:build']);
  });

  test("reads moon's own RunTask verdicts and ignores the passing ones", () => {
    const { failedTargets } = parse(
      [
        'pass RunTask(client:lint) (4s 891ms, 11f9e921)',
        'fail RunTask(schemas:typecheck) (3s 3ms, 6f98952f)',
        'fail RunTask(types:typecheck) (2s 895ms, 0024805e)',
      ].join('\n'),
    );
    expect(failedTargets).toEqual(['schemas:typecheck', 'types:typecheck']);
  });

  test("reads `moon run`'s task_runner::run_failed block", () => {
    const { failedTargets } = parse(
      [
        'task_runner::run_failed',
        '',
        '  × Task frontend-utils:lint failed to run.',
        '  ╰─▶ Process bun failed: exit code 1',
      ].join('\n'),
    );
    expect(failedTargets).toEqual(['frontend-utils:lint']);
  });

  // Regression: the last line of every failed run is the OUTER `bun run moon`
  // wrapper exiting, un-prefixed. Attributing it to whichever target printed
  // last invented a failing target (scripts:test) that had actually passed.
  test('does not blame the outer wrapper exit on the last target seen', () => {
    const { failedTargets } = parse(
      [
        '▮▮▮▮ scripts:test (70ms, fc232cca)',
        '       scripts:test | 545 pass',
        '',
        '  × Task frontend-utils:lint failed to run.',
        '',
        'error: script "moon" exited with code 1',
      ].join('\n'),
    );
    expect(failedTargets).toEqual(['frontend-utils:lint']);
  });

  test('does not call a target failed for a warning-only diagnostic', () => {
    const { failedTargets } = parse(
      [
        '  frontend-utils:lint | src/a.ts:2:2 lint/style/useConst  FIXABLE  ━━━━━',
        '  frontend-utils:lint |   ! This let declares a variable that is only assigned once.',
      ].join('\n'),
    );
    expect(failedTargets).toEqual([]);
  });

  test('collapses the streamed copy and the REVIEW re-print of one error', () => {
    const { diagnostics } = parse(
      [
        '                   types:typecheck | src/index.ts(36,1): error TS2308: Ambiguous re-export.',
        '                   types:typecheck | error: script "typecheck" exited with code 1',
        '',
        '  REVIEW ',
        '',
        '▮▮▮▮ types:typecheck',
        'src/index.ts(36,1): error TS2308: Ambiguous re-export.',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.target).toBe('types:typecheck');
  });

  // Regression: the REVIEW block is un-prefixed, so a missed header leaves
  // every path in it resolving against the previous task's project root.
  // schemas:typecheck's `../types/src/index.ts` became
  // `apps/frontend/types/src/index.ts` — a file that does not exist.
  test('re-anchors REVIEW output on the target named in its header', () => {
    const { diagnostics } = parse(
      [
        '            client:typecheck | ❌ apps/frontend/client/src/a.ts:1:1 — Broken.',
        '',
        '▮▮▮▮ schemas:typecheck',
        '../types/src/index.ts(36,1): error TS2308: Ambiguous re-export.',
        '',
        '▮▮▮▮ types:typecheck',
        'src/index.ts(36,1): error TS2308: Ambiguous re-export.',
      ].join('\n'),
    );
    const reExport = diagnostics.filter((d) => d.code === 'TS2308');
    expect(reExport).toHaveLength(1);
    expect(reExport[0]?.file).toBe('packages/shared/types/src/index.ts');
  });

  test('merges the annotation copy and the emoji copy into one full diagnostic', () => {
    const { diagnostics } = parse(
      [
        "  client:typecheck | ::error file=src/a.ts,line=5,col=2,title=svelte-check::Property 'id' does not exist on type 'AiProvider'.%0A  Property 'id' does not exist on type '\"openai\"'.",
        "  client:typecheck | ❌ apps/frontend/client/src/a.ts:5:2 — Property 'id' does not exist on type 'AiProvider'.",
        "  client:typecheck |    Property 'id' does not exist on type '\"openai\"'. [2339]",
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(1);
    // The annotation carries the long message, the emoji line carries the
    // code — the merged diagnostic must keep both.
    expect(diagnostics[0]?.code).toBe('TS2339');
    expect(diagnostics[0]?.message).toContain('"openai"');
    expect(diagnostics[0]?.tool).toBe('svelte-check');
  });

  test('keeps the richer copy when the same error appears twice', () => {
    const { diagnostics } = parse(
      [
        "  client:typecheck | ::error file=src/a.ts,line=1,col=1,title=svelte-check::Type 'A' is not assignable to type 'B'.",
        "  client:typecheck | ❌ apps/frontend/client/src/a.ts:1:1 — Type 'A' is not assignable to type 'B'.",
        '  client:typecheck |    Detailed explanation of why. [2322]',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('Detailed explanation');
  });

  test('ignores passing test output entirely', () => {
    const { diagnostics, failedTargets } = parse(
      [
        '  schemas:test | (pass) AiGatewayErrorSchema > accepts an error [0.48ms]',
        '  schemas:test | (pass) SttErrorCodeSchema > rejects an unknown code [0.05ms]',
        '  hub:build | .svelte-kit/output/server/chunks/error.js  2.83 kB │ gzip: 1.03 kB',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
    expect(failedTargets).toEqual([]);
  });

  test('strips ANSI colour before matching', () => {
    const esc = String.fromCharCode(27);
    const { diagnostics } = parse(
      `${esc}[36;1m                   types:typecheck${esc}[0m | src/index.ts(36,1): error TS2308: Ambiguous.`,
    );
    expect(diagnostics).toHaveLength(1);
  });
});
