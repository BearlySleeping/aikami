#!/usr/bin/env bun
// scripts/src/lib/agents/subagents/cli.ts
//
// `bun run subagent` — spawn and manage pi subagents from a shell. The pi
// extension (.pi/extensions/subagents.ts) reaches the same functions through
// the bridge (scripts/src/lib/pi/subagent.ts).
//
// Usage:
//   bun run subagent spawn <name> "<task>" [--write] [--model M] [--thinking T]
//                      [--skill a,b] [--no-pr] [--review auto|always|never]
//                      [--autofix] [--draft] [--base main] [--no-install]
//   bun run subagent list [--active]
//   bun run subagent status <id>
//   bun run subagent result <id>
//   bun run subagent wait <id> [--timeout-min 30]
//   bun run subagent message <id> "<text>"
//   bun run subagent kill <id>
//   bun run subagent cleanup <id> [--keep-worktree] [--purge] [--force]
//   bun run subagent supervise <id> --repo <root>     (internal)

import { resolve } from 'node:path';
import { runGit } from '../git_worktree.ts';
import {
  cleanupRun,
  getRun,
  killRun,
  listRuns,
  messageRun,
  readResult,
  waitRun,
} from './control.ts';
import { spawnSubagent } from './spawn.ts';
import { supervise } from './supervise.ts';
import type { ReviewMode, SubagentState } from './types.ts';

const VALUE_FLAGS = new Set([
  '--model',
  '--thinking',
  '--skill',
  '--review',
  '--base',
  '--repo',
  '--timeout-min',
  '--context',
]);

const parse = (argv: string[]): { positional: string[]; flags: Map<string, string | true> } => {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a)) {
        flags.set(a, argv[i + 1] ?? '');
        i++;
      } else {
        flags.set(a, true);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
};

const str = (flags: Map<string, string | true>, key: string): string | undefined => {
  const v = flags.get(key);
  return typeof v === 'string' && v ? v : undefined;
};

const repoRootFrom = (flags: Map<string, string | true>): string => {
  const explicit = str(flags, '--repo');
  if (explicit) {
    return resolve(explicit);
  }
  // Always the MAIN checkout, even when invoked from inside a worktree.
  const common = runGit('rev-parse --path-format=absolute --git-common-dir', {
    cwd: process.cwd(),
  });
  return resolve(common, '..');
};

const line = (s: SubagentState, name: string): string =>
  `${s.id}  ${s.status.padEnd(10)} ${name}  ${s.activity ?? ''}${s.pr ? `  PR #${s.pr.number}` : ''}`;

type Ctx = {
  repoRoot: string;
  id: string;
  positional: string[];
  flags: Map<string, string | true>;
};

const toReview = (v: string | undefined): ReviewMode =>
  v === 'always' || v === 'never' ? v : 'auto';

const cmdSpawn = async ({ repoRoot, positional, flags }: Ctx): Promise<number> => {
  const [name, task] = positional;
  if (!name || !task) {
    throw new Error('Usage: bun run subagent spawn <name> "<task>" [--write] ...');
  }
  const pr = {
    review: toReview(str(flags, '--review')),
    autofix: flags.has('--autofix'),
    draft: flags.has('--draft'),
  };
  const r = await spawnSubagent({
    name,
    task,
    kind: flags.has('--write') ? 'write' : 'read',
    context: str(flags, '--context'),
    model: str(flags, '--model'),
    thinking: str(flags, '--thinking'),
    skills: str(flags, '--skill')?.split(',').filter(Boolean),
    base: str(flags, '--base'),
    install: !flags.has('--no-install'),
    herdr: !flags.has('--no-herdr'),
    pr: flags.has('--no-pr') ? false : pr,
    timeoutMinutes: Number(str(flags, '--timeout-min') ?? '45'),
    repoRoot,
  });
  console.log(JSON.stringify(r, undefined, 2));
  return 0;
};

const nameOf = (c: Ctx): string => getRun(c.repoRoot, c.id).spec.name;

const COMMANDS: Record<string, (c: Ctx) => Promise<number> | number> = {
  supervise: (c) => supervise({ repoRoot: c.repoRoot, id: c.id }),
  spawn: cmdSpawn,
  list: (c) => {
    for (const r of listRuns(c.repoRoot, { active: c.flags.has('--active') })) {
      console.log(line(r.state, r.spec.name));
    }
    return 0;
  },
  status: (c) => {
    console.log(JSON.stringify(getRun(c.repoRoot, c.id).state, undefined, 2));
    return 0;
  },
  result: (c) => {
    console.log(readResult(c.repoRoot, c.id) ?? '(no result yet)');
    return 0;
  },
  wait: async (c) => {
    const s = await waitRun(
      c.repoRoot,
      c.id,
      Number(str(c.flags, '--timeout-min') ?? '60') * 60_000,
    );
    console.log(line(s, nameOf(c)));
    return s.status === 'succeeded' ? 0 : 1;
  },
  message: async (c) => {
    const text = c.positional[1];
    if (!text) {
      throw new Error('Usage: bun run subagent message <id> "<text>"');
    }
    console.log(line(await messageRun(c.repoRoot, c.id, text), nameOf(c)));
    return 0;
  },
  kill: (c) => {
    console.log(line(killRun(c.repoRoot, c.id), nameOf(c)));
    return 0;
  },
  cleanup: async (c) => {
    const done = await cleanupRun(c.repoRoot, c.id, {
      removeWorktree: !c.flags.has('--keep-worktree'),
      purge: c.flags.has('--purge'),
      force: c.flags.has('--force'),
    });
    for (const d of done) {
      console.log(`✓ ${d}`);
    }
    return 0;
  },
};

const main = async (): Promise<number> => {
  const [command, ...rest] = process.argv.slice(2);
  const handler = command ? COMMANDS[command] : undefined;
  if (!handler) {
    console.log(
      `Usage: bun run subagent <${Object.keys(COMMANDS).join('|')}> …  (see scripts/src/lib/agents/subagents/cli.ts)`,
    );
    return command ? 1 : 0;
  }
  const { positional, flags } = parse(rest);
  return handler({ repoRoot: repoRootFrom(flags), id: positional[0] ?? '', positional, flags });
};

try {
  process.exit(await main());
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
