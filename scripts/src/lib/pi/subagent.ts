// scripts/src/lib/pi/subagent.ts
//
// Bun-side bridge commands behind the `subagent` pi tool
// (.pi/extensions/subagents.ts). Mutations only — the extension reads run
// state straight from .pi/subagent-runs/<id>/state.json for cheap waiting.

import { cleanupRun, killRun, listRuns, messageRun } from '../agents/subagents/control.ts';
import { loadCatalog, pickStealthModel, resolveModel } from '../agents/subagents/models.ts';
import { spawnSubagent } from '../agents/subagents/spawn.ts';
import type { PrOptions, ReviewMode, SubagentKind } from '../agents/subagents/types.ts';
import {
  type Args,
  optionalBoolean,
  optionalNumber,
  optionalRecord,
  optionalString,
  requireString,
  toArgs,
} from './args.ts';
import type { PiHandlers } from './types.ts';

const optionalStringArray = (args: Args, key: string): string[] | undefined => {
  const v = args[key];
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;
};

const toKind = (v: string | undefined): SubagentKind | undefined =>
  v === 'read' || v === 'write' ? v : undefined;

const toReview = (v: string | undefined): ReviewMode | undefined =>
  v === 'auto' || v === 'always' || v === 'never' ? v : undefined;

const toPr = (args: Args): Partial<PrOptions> | boolean | undefined => {
  if (typeof args.pr === 'boolean') {
    return args.pr;
  }
  const pr = optionalRecord(args, 'pr');
  if (!pr) {
    return undefined;
  }
  const minutes = optionalNumber(pr, 'reviewTimeoutMinutes');
  return {
    ...(optionalBoolean(pr, 'enabled') === undefined
      ? {}
      : { enabled: optionalBoolean(pr, 'enabled') }),
    ...(optionalString(pr, 'base') ? { base: optionalString(pr, 'base') } : {}),
    ...(optionalString(pr, 'title') ? { title: optionalString(pr, 'title') } : {}),
    ...(optionalBoolean(pr, 'draft') === undefined ? {} : { draft: optionalBoolean(pr, 'draft') }),
    ...(toReview(optionalString(pr, 'review'))
      ? { review: toReview(optionalString(pr, 'review')) }
      : {}),
    ...(optionalBoolean(pr, 'autofix') === undefined
      ? {}
      : { autofix: optionalBoolean(pr, 'autofix') }),
    ...(minutes === undefined ? {} : { reviewTimeoutMs: minutes * 60_000 }),
  };
};

export const handlers: PiHandlers = {
  'subagent.spawn': (payload) => {
    const args = toArgs(payload);
    return spawnSubagent({
      repoRoot: requireString(args, 'repoRoot'),
      name: requireString(args, 'name'),
      task: requireString(args, 'task'),
      kind: toKind(optionalString(args, 'kind')),
      context: optionalString(args, 'context'),
      model: optionalString(args, 'model'),
      thinking: optionalString(args, 'thinking'),
      skills: optionalStringArray(args, 'skills'),
      noSkillDiscovery: optionalBoolean(args, 'noSkillDiscovery'),
      tools: optionalStringArray(args, 'tools'),
      excludeTools: optionalStringArray(args, 'excludeTools'),
      base: optionalString(args, 'base'),
      install: optionalBoolean(args, 'install'),
      reuseCheckout: optionalString(args, 'reuseCheckout'),
      pr: toPr(args),
      timeoutMinutes: optionalNumber(args, 'timeoutMinutes'),
      herdr: optionalBoolean(args, 'herdr'),
      captainSessionId: optionalString(args, 'captainSessionId'),
    });
  },

  'subagent.message': (payload) => {
    const args = toArgs(payload);
    return messageRun(
      requireString(args, 'repoRoot'),
      requireString(args, 'id'),
      requireString(args, 'text'),
    );
  },

  'subagent.kill': (payload) => {
    const args = toArgs(payload);
    return killRun(requireString(args, 'repoRoot'), requireString(args, 'id'));
  },

  'subagent.cleanup': (payload) => {
    const args = toArgs(payload);
    return cleanupRun(requireString(args, 'repoRoot'), requireString(args, 'id'), {
      removeWorktree: optionalBoolean(args, 'removeWorktree'),
      purge: optionalBoolean(args, 'purge'),
      force: optionalBoolean(args, 'force'),
    });
  },

  'subagent.list': (payload) => {
    const args = toArgs(payload);
    return listRuns(requireString(args, 'repoRoot'), { active: optionalBoolean(args, 'active') });
  },

  'subagent.models': (payload) => {
    const repoRoot = requireString(toArgs(payload), 'repoRoot');
    const catalog = loadCatalog(repoRoot);
    return {
      default: resolveModel({ repoRoot, catalog }),
      stealth: catalog
        .filter((e) => e.provider === 'openrouter' && e.model.startsWith('stealth/'))
        .map((e) => `${e.provider}/${e.model}`),
      free: catalog.filter((e) => e.model.endsWith(':free')).map((e) => `${e.provider}/${e.model}`),
      pickedStealth: pickStealthModel(catalog),
    };
  },
};
