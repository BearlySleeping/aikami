// scripts/src/lib/pi/herdr.ts
//
// Bun-side implementations of the herdr bridge commands. These wrap the
// canonical session/worktree modules so pi extensions (Node) never import
// them directly.

import { type DevService, KNOWN_SERVICES } from '@aikami/constants';
import {
  buildSessionName,
  currentContractId,
  findWorkspace,
  getWorkspaceTabNames,
  isPortReady,
  listServices,
  resolveReadyPort,
  restartServices,
  SERVICE_DEFS,
  startServices,
  stopServices,
} from '../herdr/session.ts';
import { openPullRequest, publishWorktree, worktreeRepoRoot } from '../herdr/worktree.ts';
import {
  type Args,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireMode,
  requireNumber,
  requireString,
  requireStringArray,
  toArgs,
} from './args.ts';
import type { PiHandlers } from './types.ts';

const isDevService = (value: string): value is DevService =>
  (KNOWN_SERVICES as readonly string[]).includes(value);

const requireService = (args: Args, key: string): DevService => {
  const value = requireString(args, key);
  if (!isDevService(value)) {
    throw new Error(`Unknown service: ${value}. Valid: ${KNOWN_SERVICES.join(', ')}`);
  }
  return value;
};

export const handlers: PiHandlers = {
  'herdr.session.currentContractId': () => currentContractId(),

  'herdr.session.buildName': (payload) => {
    const args = toArgs(payload);
    return buildSessionName(requireMode(args, 'mode'), optionalString(args, 'contractId'));
  },

  /** The workspace name for the current context (contract-scoped when applicable). */
  'herdr.session.workspaceName': (payload) =>
    buildSessionName(requireMode(toArgs(payload), 'mode'), currentContractId()),

  'herdr.session.start': async (payload) => {
    const args = toArgs(payload);
    return startServices({
      mode: requireMode(args, 'mode'),
      services: requireStringArray(args, 'services').map((service) => {
        if (!isDevService(service)) {
          throw new Error(`Unknown service: ${service}`);
        }
        return service;
      }),
      projectRoot: requireString(args, 'projectRoot'),
      forcePorts: optionalBoolean(args, 'forcePorts'),
    });
  },

  'herdr.session.stop': async (payload) => {
    const args = toArgs(payload);
    return stopServices({
      mode: requireMode(args, 'mode'),
      services: requireStringArray(args, 'services').map((service) => {
        if (!isDevService(service)) {
          throw new Error(`Unknown service: ${service}`);
        }
        return service;
      }),
    });
  },

  'herdr.session.restart': async (payload) => {
    const args = toArgs(payload);
    return restartServices({
      mode: requireMode(args, 'mode'),
      services: requireStringArray(args, 'services').map((service) => {
        if (!isDevService(service)) {
          throw new Error(`Unknown service: ${service}`);
        }
        return service;
      }),
      projectRoot: requireString(args, 'projectRoot'),
    });
  },

  'herdr.session.list': (payload) => listServices(requireMode(toArgs(payload), 'mode')),

  'herdr.workspace.find': (payload) => findWorkspace(requireString(toArgs(payload), 'label')),

  'herdr.workspace.tabNames': (payload) =>
    getWorkspaceTabNames(requireString(toArgs(payload), 'workspaceId')),

  'herdr.port.ready': (payload) => {
    const args = toArgs(payload);
    const check = optionalString(args, 'check');
    return isPortReady(requireNumber(args, 'port'), check === 'tcp' ? 'tcp' : 'http');
  },

  /** Resolve a service's canonical name, ready port (offset-aware) and probe kind. */
  'herdr.service.info': (payload) => {
    const args = toArgs(payload);
    const service = requireService(args, 'service');
    const def = SERVICE_DEFS[service];
    return {
      name: def.name,
      readyPort: resolveReadyPort(
        service,
        requireMode(args, 'mode'),
        optionalNumber(args, 'offset') ?? 0,
      ),
      readyCheck: def.readyCheck ?? 'http',
    };
  },

  'herdr.worktree.repoRoot': (payload) =>
    worktreeRepoRoot(requireString(toArgs(payload), 'checkoutPath')),

  'herdr.worktree.publish': async (payload) => {
    const args = toArgs(payload);
    return publishWorktree({
      checkoutPath: requireString(args, 'checkoutPath'),
      repoRoot: requireString(args, 'repoRoot'),
      base: optionalString(args, 'base'),
      message: optionalString(args, 'message'),
      authorName: optionalString(args, 'authorName'),
      authorEmail: optionalString(args, 'authorEmail'),
    });
  },

  'herdr.worktree.openPr': async (payload) => {
    const args = toArgs(payload);
    return openPullRequest({
      headBranch: requireString(args, 'headBranch'),
      base: requireString(args, 'base'),
      title: requireString(args, 'title'),
      body: optionalString(args, 'body'),
      draft: optionalBoolean(args, 'draft') ?? false,
    });
  },
};
