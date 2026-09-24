// scripts/src/lib/agents/subagents/prompt.ts
//
// Builds the appended system prompt and the turn-1 task message for a
// subagent. Skills named by the captain are INLINED (not just listed) so the
// subagent does not burn a turn reading them — cheaper and more reliable than
// hoping a small model decides to load the right SKILL.md.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SubagentSpec } from './types.ts';

const SKILL_ROOTS = ['.pi/skills', '.pi/generated-skills'];

/** Locate `<root>/**\/<name>/SKILL.md` (depth ≤ 2). */
export const findSkillFile = (repoRoot: string, name: string): string | undefined => {
  for (const root of SKILL_ROOTS) {
    const base = join(repoRoot, root);
    const direct = join(base, name, 'SKILL.md');
    if (existsSync(direct)) {
      return direct;
    }
    if (!existsSync(base)) {
      continue;
    }
    for (const group of readdirSync(base, { withFileTypes: true })) {
      if (!group.isDirectory()) {
        continue;
      }
      const nested = join(base, group.name, name, 'SKILL.md');
      if (existsSync(nested)) {
        return nested;
      }
    }
  }
  return undefined;
};

const stripFrontmatter = (text: string): string => text.replace(/^---\n[\s\S]*?\n---\n/, '');

const KIND_RULES: Record<SubagentSpec['kind'], (w: WorkspaceInfo) => string> = {
  read: () =>
    [
      '## Mode: READ-ONLY',
      '- Do NOT modify, create or delete files. Your cwd is the shared main checkout —',
      '  other agents and the human are working in it. Mutation tools are disabled; do',
      '  not work around that with shell redirects, `sed -i`, git commands, etc.',
      '- Investigate, then report. Cite evidence as `path:line`.',
    ].join('\n'),
  write: (w) =>
    [
      '## Mode: WRITE (isolated worktree)',
      `- You work in a private git worktree: \`${w.checkoutPath ?? '(cwd)'}\` on branch \`${w.branch ?? '?'}\`.`,
      '  Nobody else touches it. Stay inside it — never edit the main checkout.',
      '- Do NOT push, open PRs, or merge. Committing, pushing and the PR are handled for',
      '  you after you finish; uncommitted changes are fine.',
      '- Before finishing a code change, run the `validate` tool (fix + typecheck +',
      '  structural guards) and fix what it reports. Guards red → fix code, never policy.',
      '- Keep the diff focused on the task; no drive-by refactors.',
    ].join('\n'),
};

type WorkspaceInfo = { checkoutPath?: string; branch?: string };

export const buildSystemPrompt = (spec: SubagentSpec, workspace: WorkspaceInfo): string => {
  const sections: string[] = [
    '# Subagent brief',
    'You are a SUBAGENT spawned by a captain agent to complete one task. You run',
    'non-interactively: nobody will answer questions, so make reasonable assumptions,',
    'note them, and finish. If truly blocked, stop and explain exactly what is missing.',
    '',
    KIND_RULES[spec.kind](workspace),
    '',
    '## Final answer contract',
    'Your FINAL assistant message is returned verbatim to the captain — it is the ONLY',
    'thing the captain sees. Make it self-contained:',
    spec.kind === 'write'
      ? '1. First line: `TITLE: <conventional-commit title>` (e.g. `TITLE: fix(hub): ...`).'
      : '1. First line: one-sentence outcome.',
    '2. What you found / changed, with `path:line` references.',
    '3. Verification you ran and its result.',
    '4. Open risks, assumptions, or follow-ups.',
    'Be dense; skip pleasantries. Aim for < 400 words unless the task needs more.',
  ];

  if (spec.context) {
    sections.push('', '## Context from the captain', spec.context);
  }

  const missing: string[] = [];
  for (const name of spec.skills) {
    const file = findSkillFile(spec.repoRoot, name);
    if (!file) {
      missing.push(name);
      continue;
    }
    sections.push('', `## Skill: ${name}`, stripFrontmatter(readFileSync(file, 'utf8')).trim());
  }
  if (missing.length > 0) {
    sections.push('', `(Requested skills not found: ${missing.join(', ')})`);
  }
  return sections.join('\n');
};

export const buildTaskMessage = (spec: SubagentSpec): string =>
  `${spec.task.trim()}\n\nWhen done, end with the final answer described in your brief.`;

/** Split a write agent's final answer into PR title + body. */
export const splitTitle = (result: string): { title?: string; body: string } => {
  const m = result.match(/^\s*TITLE:\s*(.+)\n?/);
  if (!m?.[1]) {
    return { body: result.trim() };
  }
  return { title: m[1].trim().slice(0, 120), body: result.slice(m[0].length).trim() };
};
