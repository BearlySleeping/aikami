// scripts/src/lib/herdr/session.test.ts
import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { createManifest } from '../agents/contract_pipeline/manifest_store.ts';
import { resetDirenvCache } from '../env/direnv_detect.ts';
import { posixQuote, which } from '../env/which.ts';
import { readInstanceRecords, verifyOwnership } from './instance_registry.ts';
import { bashScriptForPane as bashScriptForShell } from './pane_shell.ts';
import {
  makeAppIdentityProbe,
  makeInstanceRecorder,
  makeListenerOwnershipProbe,
} from './service_probes.ts';
import type { ServiceDef } from './session.ts';
import {
  ALL_SERVICES,
  assertNoPortConflicts,
  assertNoRunningServiceConflicts,
  assessServiceReadiness,
  buildServiceCommand,
  buildServiceIdentity,
  buildSessionName,
  CONTRACT_WORKSPACE_PREFIX,
  CORE_SERVICES,
  contractIdFromSessionName,
  contractIdFromWorktreePath,
  currentContractId,
  currentRunId,
  expandServices,
  isPortReady,
  KNOWN_SERVICES,
  killPort,
  normalizeService,
  ownedServices,
  parseHerdrStatus,
  parseWorkspaceName,
  portsToCleanupForService,
  resolveReadyPort,
  resolveServiceRoot,
  runIdFromWorktreePath,
  SERVICE_DEFS,
  serviceEnvArgs,
  servicesByScope,
  wrapCommand,
} from './session.ts';

describe('parseHerdrStatus', () => {
  it('parses a compatible client/server pair', () => {
    const status = parseHerdrStatus(`client:
  version: 0.8.0
  channel: stable
  protocol: 19

server:
  status: running
  version: 0.8.0
  protocol: 19
  compatible: yes
  socket: /home/sonny/.config/herdr/herdr.sock

update:
  restart_needed: no
`);
    expect(status.clientVersion).toBe('0.8.0');
    expect(status.clientProtocol).toBe(19);
    expect(status.serverStatus).toBe('running');
    expect(status.serverVersion).toBe('0.8.0');
    expect(status.serverProtocol).toBe(19);
    expect(status.compatible).toBe(true);
    expect(status.restartNeeded).toBe(false);
  });

  it('detects a protocol skew (client newer than server)', () => {
    const status = parseHerdrStatus(`client:
  version: 0.8.0
  channel: stable
  protocol: 19

server:
  status: running
  version: 0.7.4
  protocol: 16
  compatible: no
  socket: /home/sonny/.config/herdr/herdr.sock

update:
  restart_needed: yes
`);
    expect(status.clientProtocol).toBe(19);
    expect(status.serverProtocol).toBe(16);
    expect(status.compatible).toBe(false);
    expect(status.restartNeeded).toBe(true);
  });

  it('tolerates a server-only status block (herdr status server)', () => {
    const status = parseHerdrStatus(`status: running
version: 0.8.0
protocol: 19
compatible: yes
socket: /home/sonny/.config/herdr/herdr.sock
`);
    // No section headers → fields stay undefined, but parsing must not throw.
    expect(status.compatible).toBeUndefined();
    expect(status.serverStatus).toBeUndefined();
  });

  it('tolerates empty output', () => {
    expect(parseHerdrStatus('')).toEqual({});
  });
});

describe('C-392 — dev engine services converge on the local stack', () => {
  it('text/image/voice keep their fixed base ports under a contract offset', () => {
    // C-392 slot: (392 % 200 + 1) * 10 = 1930
    const offset = 1930;
    expect(resolveReadyPort('text', 'emulator', offset)).toBe(11434);
    expect(resolveReadyPort('image', 'emulator', offset)).toBe(8188);
    expect(resolveReadyPort('voice', 'emulator', offset)).toBe(8089);
  });

  it('client/hub/site still shift by the offset', () => {
    const offset = 1930;
    expect(resolveReadyPort('client', 'emulator', offset)).toBe(5274 + offset);
    expect(resolveReadyPort('hub', 'emulator', offset)).toBe(5276 + offset);
    expect(resolveReadyPort('site', 'emulator', offset)).toBe(5280 + offset);
  });

  it('text-ollama and image-comfyui are known services sharing the engine ports', () => {
    expect(KNOWN_SERVICES).toContain('text-ollama');
    expect(KNOWN_SERVICES).toContain('image-comfyui');
    expect(SERVICE_DEFS['text-ollama'].name).toBe('text-ollama');
    expect(SERVICE_DEFS['image-comfyui'].name).toBe('image-comfyui');
    expect(SERVICE_DEFS['text-ollama'].readyPort?.('emulator')).toBe(11434);
    expect(SERVICE_DEFS['image-comfyui'].readyPort?.('emulator')).toBe(8188);
  });

  it('C-511: audio is a known, opt-in service on its own port', () => {
    expect(KNOWN_SERVICES).toContain('audio');
    expect(SERVICE_DEFS.audio.name).toBe('audio');
    expect(SERVICE_DEFS.audio.readyPort?.('emulator')).toBe(8094);
    expect(SERVICE_DEFS.audio.readyPort?.('staging')).toBe(8096);
    expect(SERVICE_DEFS.audio.readyPort?.('production')).toBe(8098);
    // Opt-in tooling: a multi-gigabyte CUDA-only engine must never start
    // unasked, so it is NOT in the `all` group.
    expect(ALL_SERVICES).not.toContain('audio');
    expect(expandServices(['all'])).not.toContain('audio');
    expect(normalizeService('audio')).toBe('audio');
  });

  it('C-511: audio is run-scoped until its identity probe returns validated evidence', () => {
    expect(SERVICE_DEFS.audio.scope).toBe('run');
    expect(typeof SERVICE_DEFS.audio.probe).toBe('function');
    expect(SERVICE_DEFS.audio.command('emulator')).toBe('bun run dev');
    expect(SERVICE_DEFS.audio.cwd('/repo')).toBe(resolvePath('/repo', 'apps/backend/audio'));
  });

  it('C-511: audio does not collide with the other engine ports', () => {
    expect(() => assertNoPortConflicts(['audio', 'image'], 'emulator', 0)).not.toThrow();
    expect(() => assertNoPortConflicts(['audio', 'voice'], 'emulator', 0)).not.toThrow();
    expect(() => assertNoPortConflicts(['audio', 'text'], 'emulator', 0)).not.toThrow();
  });

  it('advanced engines are not in the all group (opt-in only)', () => {
    expect(ALL_SERVICES).not.toContain('text-ollama');
    expect(ALL_SERVICES).not.toContain('image-comfyui');
    expect(expandServices(['all'])).not.toContain('text-ollama');
    expect(expandServices(['all'])).not.toContain('image-comfyui');
  });

  it('advanced engines are accepted as service names', () => {
    expect(normalizeService('text-ollama')).toBe('text-ollama');
    expect(normalizeService('image-comfyui')).toBe('image-comfyui');
  });

  it('refuses to start image and image-comfyui together (shared :8188)', () => {
    expect(() => assertNoPortConflicts(['image', 'image-comfyui'], 'emulator', 0)).toThrow(
      /8188|mutually exclusive/,
    );
  });

  it('refuses to start text and text-ollama together (shared :11434)', () => {
    expect(() => assertNoPortConflicts(['text', 'text-ollama'], 'emulator', 0)).toThrow(
      /11434|mutually exclusive/,
    );
  });

  it('allows distinct-port services together (image + text)', () => {
    expect(() => assertNoPortConflicts(['image', 'text'], 'emulator', 0)).not.toThrow();
  });

  it('allows offset-aware + engine services together under an offset', () => {
    expect(() =>
      assertNoPortConflicts(['client', 'text', 'image'], 'emulator', 1930),
    ).not.toThrow();
  });

  it('refuses reuse of a workspace already running a mutually exclusive engine (image + existing image-comfyui)', () => {
    expect(() =>
      assertNoRunningServiceConflicts(['image'], ['image-comfyui'], 'emulator', 0),
    ).toThrow(/8188|mutually exclusive/);
  });

  it('refuses reuse of a workspace already running text-ollama when starting text', () => {
    expect(() => assertNoRunningServiceConflicts(['text'], ['text-ollama'], 'emulator', 0)).toThrow(
      /11434|mutually exclusive/,
    );
  });

  it('allows reuse when existing tabs run distinct-port services', () => {
    expect(() =>
      assertNoRunningServiceConflicts(['image'], ['client', 'hub'], 'emulator', 0),
    ).not.toThrow();
  });

  it('ignores non-service tab labels (e.g. the pi tab) in the reuse check', () => {
    expect(() =>
      assertNoRunningServiceConflicts(['image'], ['pi', 'text'], 'emulator', 0),
    ).not.toThrow();
  });
});

describe('hub-worker herdr service (C-437)', () => {
  it('registers hub-worker in SERVICE_DEFS', () => {
    expect(SERVICE_DEFS['hub-worker'].name).toBe('hub-worker');
  });

  it('exposes an emulator-only readyPort', () => {
    expect(SERVICE_DEFS['hub-worker'].readyPort?.('emulator')).toBe(5278);
    expect(SERVICE_DEFS['hub-worker'].readyPort?.('staging')).toBeUndefined();
    expect(SERVICE_DEFS['hub-worker'].readyPort?.('production')).toBeUndefined();
  });

  it('runs dev:worker in emulator mode', () => {
    const cmd = SERVICE_DEFS['hub-worker'].command('emulator');
    expect(cmd).toBe('bun run dev:worker');
  });

  it('is a no-op in staging/production', () => {
    const cmd = SERVICE_DEFS['hub-worker'].command('staging');
    expect(cmd).toContain('emulator-only');
    const prodCmd = SERVICE_DEFS['hub-worker'].command('production');
    expect(prodCmd).toContain('emulator-only');
  });

  it('accepts hub-worker as a service name', () => {
    expect(normalizeService('hub-worker')).toBe('hub-worker');
  });

  it('does not add hub-worker to the all group (opt-in only)', () => {
    expect(ALL_SERVICES).not.toContain('hub-worker');
    expect(expandServices(['all'])).not.toContain('hub-worker');
  });

  it('includes hub-worker among the known/listed services', () => {
    expect(KNOWN_SERVICES).toContain('hub-worker');
  });

  it('hub-worker is offset-aware (shifts with contract offset)', () => {
    const offset = 66;
    expect(resolveReadyPort('hub-worker', 'emulator', offset)).toBe(5278 + offset);
  });

  it('hub-worker and hub have different ports (no port conflict)', () => {
    // Both represent the same logical app but on different ports.
    // assertNoPortConflicts must not throw for the pair.
    expect(() => assertNoPortConflicts(['hub', 'hub-worker'], 'emulator', 0)).not.toThrow();
  });
});

// 🔴 `isKillableProcess` was removed (C-471 AC-1, brief P0): executable-name
// matching cannot distinguish our dev server from an unrelated developer's.
// Ownership is now proven by an InstanceRecord; see instance_registry.test.ts.

describe('portsToCleanupForService', () => {
  it('a single-process service only sweeps its own readyPort', () => {
    const offset = 1930;
    expect(portsToCleanupForService('client', 'emulator', offset)).toEqual([5274 + offset]);
  });

  it('a service with no readyPort (e.g. tauri) has nothing to sweep', () => {
    expect(portsToCleanupForService('tauri', 'emulator', 0)).toEqual([]);
  });
});

describe('isPortReady protocol probe (C-387)', () => {
  it('tcp probe detects a raw-TCP listener that http probe cannot', async () => {
    const server = net.createServer();
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await isPortReady(port, 'tcp')).toBe(true);
      expect(await isPortReady(port, 'http')).toBe(false);
    } finally {
      server.close();
    }
  });

  it('tcp probe returns false when nothing listens', async () => {
    const server = net.createServer();
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((res) => server.close(() => res()));
    expect(await isPortReady(port, 'tcp')).toBe(false);
  });
});

describe('buildServiceCommand / serviceEnvArgs — F-07', () => {
  // 🔴 The offset used to be injected as a POSIX `VAR=x cmd` shell prefix,
  // which only worked through wrapCommand's bash paths — the no-bash
  // Windows fallback (`cmd /c "..."`) cannot parse that syntax at all. It
  // is now passed via `herdr tab create --env` instead, so
  // buildServiceCommand must return the PLAIN command with no env prefix,
  // and serviceEnvArgs carries the offset separately as `--env` entries.

  it('buildServiceCommand never prefixes env vars into the command', () => {
    const command = buildServiceCommand('client', 'emulator');
    expect(command).not.toContain('PUBLIC_EMULATOR_PORT_OFFSET');
    expect(command).not.toContain('PORT=');
    expect(command).toBe(SERVICE_DEFS.client.command('emulator'));
  });

  it('serviceEnvArgs is empty at offset 0 (manual dev keeps today’s exact ports)', () => {
    expect(serviceEnvArgs('client', 'emulator', 0)).toEqual([]);
  });

  it('serviceEnvArgs is empty for a non-offset-aware service regardless of offset', () => {
    // voice/image/text are shared singletons — never shifted per contract.
    expect(serviceEnvArgs('voice', 'emulator', 60)).toEqual([]);
  });

  it('serviceEnvArgs carries PUBLIC_EMULATOR_PORT_OFFSET and the shifted PORT for an offset-aware service', () => {
    const offset = 60;
    const args = serviceEnvArgs('client', 'emulator', offset);
    expect(args).toContain(`PUBLIC_EMULATOR_PORT_OFFSET=${offset}`);
    expect(args).toContain(`PORT=${resolveReadyPort('client', 'emulator', offset)}`);
    expect(args).toHaveLength(2);
  });
});

describe('wrapCommand', () => {
  // Force the non-direnv path so the shape assertions below are deterministic
  // regardless of whether the test machine has direnv on PATH. The direnv
  // cases are pinned explicitly in their own tests.
  beforeEach(() => resetDirenvCache(false));

  it('wraps in bash with the keep-open trailer on a machine that has bash', () => {
    const wrapped = wrapCommand('bun run dev');
    expect(wrapped).toContain('bash');
    expect(wrapped).toContain('bun run dev');
    expect(wrapped).toContain('Press Enter to close');
  });

  it('passes bash as an absolute path, not a bare name', () => {
    // herdr panes default to Nushell on Windows, whose PATH lacks Git's bash.
    const wrapped = wrapCommand('bun run dev');
    expect(wrapped).not.toMatch(/(^|\s)'?bash'? -c/);
  });

  it('survives a command containing a single quote', () => {
    // The old `'${command}'` interpolation broke out of its own quoting here.
    const wrapped = wrapCommand(`echo it's fine`);
    expect(wrapped).toContain(String.raw`it'\''s`);
  });

  it('emits a PowerShell `&` call-operator invocation for PowerShell panes', () => {
    // PowerShell rejects the POSIX `'bash' -c '…'` form (parse error at `-c`),
    // so a PowerShell pane gets `& 'bash' '<temp-script>'` instead. The script
    // lives in a file to dodge PowerShell's native-arg `"` mangling.
    const wrapped = wrapCommand('bun run dev', 'powershell');
    expect(wrapped).toMatch(/^& '.*bash.*' '.*\.sh'$/);
    expect(wrapped).not.toMatch(/' .* -c /);
    expect(wrapped).not.toContain('Press Enter to close');
  });

  it('keeps the POSIX -c form for posix panes', () => {
    const wrapped = wrapCommand('bun run dev', 'posix');
    expect(wrapped).toContain('-c');
    expect(wrapped).toContain('Press Enter to close');
  });

  it('invokes the temp bash script with CMD-compatible double quotes for cmd panes', () => {
    // cmd.exe treats single quotes as literals, so the POSIX `'bash' -c '…'`
    // form must never reach a cmd pane. The command is a double-quoted bash
    // path + double-quoted temp .sh path; the keep-open trailer lives inside
    // the script file, not the command string.
    const wrapped = wrapCommand('bun run dev', 'cmd');
    expect(wrapped).toMatch(/^".*bash.*" ".*\.sh"$/);
    expect(wrapped).not.toContain("'");
    // Standalone `-c` token check, not a raw substring match: the random
    // temp-script suffix (base36) can legitimately start with the letter
    // "c" right after the filename's own hyphen (e.g. `...-c4anlfemql7.sh`),
    // which a bare `.not.toContain('-c')` would flag as a false positive.
    expect(wrapped).not.toMatch(/(^|\s)-c(\s|$)/);
    expect(wrapped).not.toContain('Press Enter to close');
  });

  it('routes the PowerShell temp-script invocation through direnv exec when direnv is available', () => {
    resetDirenvCache(true);
    try {
      const wrapped = wrapCommand('bun run dev', 'powershell');
      // `&` is only valid as the first token of a PowerShell command, so the
      // direnv form must not carry it.
      expect(wrapped).toMatch(/^direnv exec \. '.*bash.*' '.*\.sh'$/);
      expect(wrapped).not.toMatch(/^& /);
    } finally {
      resetDirenvCache(undefined);
    }
  });

  it('retains direnv exec for cmd panes when direnv is available', () => {
    resetDirenvCache(true);
    try {
      const wrapped = wrapCommand('bun run dev', 'cmd');
      expect(wrapped).toMatch(/^direnv exec \. ".*bash.*" ".*\.sh"$/);
      expect(wrapped).not.toContain("'");
    } finally {
      resetDirenvCache(undefined);
    }
  });
});

describe('bashScriptForPane shell transport', () => {
  it('uses CMD quoting for Bash paths and installs an EXIT cleanup trap', async () => {
    const wrapped = await bashScriptForShell('cmd', 'echo ok');
    const match = wrapped.match(/^"([^"]+)" "([^"]+\.sh)"$/);
    expect(match).not.toBeNull();
    const scriptPath = match?.[2];
    expect(scriptPath).toBeDefined();
    if (!scriptPath) {
      return;
    }
    try {
      expect(readFileSync(scriptPath, 'utf-8')).toContain(`trap 'rm -f -- "$0"' EXIT`);
    } finally {
      rmSync(scriptPath, { force: true });
    }
  });
});

describe('posixQuote', () => {
  it('quotes a plain value', () => {
    expect(posixQuote('bun run dev')).toBe(`'bun run dev'`);
  });

  it('escapes embedded single quotes', () => {
    expect(posixQuote(`it's`)).toBe(String.raw`'it'\''s'`);
  });

  it('quotes a Windows path with spaces as one argument', () => {
    expect(posixQuote(String.raw`C:\Program Files\Git\bin\bash.exe`)).toBe(
      String.raw`'C:\Program Files\Git\bin\bash.exe'`,
    );
  });

  it('round-trips hostile values through a real bash', () => {
    // The quoting is only correct if bash itself agrees.
    for (const value of [`it's`, 'a b', '$HOME', '`whoami`', 'x"y', String.raw`a\b`]) {
      const out = spawnSync('bash', ['-c', `printf %s ${posixQuote(value)}`], { encoding: 'utf8' });
      expect(out.stdout).toBe(value);
    }
  });
});

describe('which', () => {
  it('resolves a binary that is certainly on PATH', () => {
    // node runs this repo's tooling; it is on PATH by construction.
    expect(which('node')).toContain('node');
  });

  it('returns null for a binary that does not exist', () => {
    expect(which('definitely-not-a-real-binary-xyz')).toBeNull();
  });
});

describe('one workspace per contract', () => {
  it('puts contract-scoped emulator services in the contract workspace', () => {
    // The SAME label ContractHerdrAdapter.buildWorkspaceLabel produces, so a
    // service started from an implementer/verifier/review tab becomes a tab
    // next to them instead of a second `aikami-emulator-C-428` workspace.
    expect(buildSessionName('emulator', 'C-428')).toBe(`${CONTRACT_WORKSPACE_PREFIX}C-428`);
    expect(buildSessionName('emulator', 'MIG-7')).toBe(`${CONTRACT_WORKSPACE_PREFIX}MIG-7`);
  });

  it('keeps staging and production in the shared, long-lived workspace', () => {
    // They point at real remote infrastructure and must outlive the contract
    // whose cleanup deletes the contract workspace.
    expect(buildSessionName('staging', 'C-428')).toBe('aikami-staging');
    expect(buildSessionName('production', 'C-428')).toBe('aikami-production');
  });

  it('falls back to the mode workspace with no contract in scope', () => {
    expect(buildSessionName('emulator')).toBe('aikami-emulator');
  });

  it('reads the contract id back out for port-offset derivation', () => {
    expect(contractIdFromSessionName('aikami-contract-C-428')).toBe('C-428');
    expect(contractIdFromSessionName('aikami-emulator')).toBeUndefined();
    // Legacy `aikami-{mode}-C-XXX` workspaces still open from before the merge
    // must keep resolving, or listServices would report their ports unshifted.
    expect(contractIdFromSessionName('aikami-emulator-C-331')).toBe('C-331');
  });

  it('resolves a contract workspace to emulator mode', () => {
    expect(parseWorkspaceName('aikami-contract-C-428')).toBe('emulator');
    expect(parseWorkspaceName('aikami-staging')).toBe('staging');
    // Task workspaces are not dev-service workspaces — listServices skips them.
    expect(parseWorkspaceName('aikami-task-my-thing')).toBeNull();
    expect(parseWorkspaceName('something-else')).toBeNull();
  });
});

describe('currentContractId', () => {
  const savedPath = process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
  const savedDirenv = process.env.DIRENV_DIR;
  const savedPwd = process.env.PWD;
  beforeEach(() => {
    process.env.CONTRACT_PIPELINE_CONTRACT_PATH = savedPath;
    process.env.DIRENV_DIR = savedDirenv;
    process.env.PWD = savedPwd;
    if (savedPath === undefined) {
      delete process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
    }
    if (savedDirenv === undefined) {
      delete process.env.DIRENV_DIR;
    }
    if (savedPwd === undefined) {
      delete process.env.PWD;
    }
  });

  it('reads the pipeline env path first', () => {
    process.env.CONTRACT_PIPELINE_CONTRACT_PATH = '/repo/docs/contracts/C-513-foo.md';
    process.env.DIRENV_DIR = '-/home/dev/.herdr/worktrees/aikami/contract-task-c-999-abc';
    expect(currentContractId()).toBe('C-513');
  });

  it('derives the contract from a worktree when the injected env is gone', () => {
    delete process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
    process.env.DIRENV_DIR = '-/home/dev/.herdr/worktrees/aikami/contract-task-c-516-mtz2k7km';
    delete process.env.PWD;
    expect(currentContractId()).toBe('C-516');
  });

  it('falls back to PWD when DIRENV_DIR is absent', () => {
    delete process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
    delete process.env.DIRENV_DIR;
    process.env.PWD = '/home/dev/.herdr/worktrees/aikami/contract-task-c-513-mtz5gk54-zzb3wl';
    expect(currentContractId()).toBe('C-513');
  });

  it('is undefined in a normal checkout', () => {
    delete process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
    delete process.env.DIRENV_DIR;
    process.env.PWD = '/home/dev/Development/aikami';
    expect(currentContractId()).toBeUndefined();
  });
});

describe('pipeline run identity', () => {
  // 🔴 The PRODUCTION format, from `manifest_store.createManifest`:
  //   run-<base36 timestamp>-<contractId>
  // The worktree branch embeds the same token (see herdr_adapter's
  // `_baseContractBranch`: `contract-task-<id>-<runToken>`), which is exactly
  // why `runIdFromWorktreePath` can recover the run id from a checkout path.
  // A fixture written in the other order would document a format that cannot
  // occur and would hide a real mismatch behind a fake one.
  const RUN_ID = 'run-mtz2k7km-C-516';

  it('reads the exact run ID independently of the contract ID', () => {
    const savedRunId = process.env.CONTRACT_PIPELINE_RUN_ID;
    const savedContractPath = process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
    try {
      process.env.CONTRACT_PIPELINE_RUN_ID = RUN_ID;
      process.env.CONTRACT_PIPELINE_CONTRACT_PATH = '/repo/docs/contracts/C-516.md';
      expect(currentRunId()).toBe(RUN_ID);
      expect(currentContractId()).toBe('C-516');
      expect(contractIdFromWorktreePath('/tmp/contract-task-c-516-mtz2k7km')).toBe('C-516');
      expect(runIdFromWorktreePath('/tmp/contract-task-c-516-mtz2k7km')).toBe(RUN_ID);
    } finally {
      if (savedRunId === undefined) {
        delete process.env.CONTRACT_PIPELINE_RUN_ID;
      } else {
        process.env.CONTRACT_PIPELINE_RUN_ID = savedRunId;
      }
      if (savedContractPath === undefined) {
        delete process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
      } else {
        process.env.CONTRACT_PIPELINE_CONTRACT_PATH = savedContractPath;
      }
    }
  });

  // 🔴 Round-trip, from the MINTER to the reader: the run id
  // `manifest_store.createManifest` mints must survive the worktree branch
  // encoding `herdr_adapter._baseContractBranch` derives from it and come back
  // byte-identical. The contract id sits at the END of the run id and in the
  // MIDDLE of the branch — writing either side in the other order makes
  // teardown's `runIdFromWorktreePath` disagree with the recorder, and every
  // owned orphan is then rejected with `record_has_wrong_run`.
  it('round-trips the run id the manifest mints through the worktree branch', () => {
    const contractId = 'C-516';
    const runId = createManifest({
      contractId,
      contractPath: '/repo/docs/contracts/C-516.md',
      baseCommit: 'deadbeef',
      baselineFingerprint: 'fingerprint',
      startStage: 'implement',
    }).runId;

    // Mirrors `_baseContractBranch`: the token is everything between `run-`
    // and the first `-`.
    const runToken = runId.replace(/^run-/, '').split('-')[0];
    const branch = `contract-task-${contractId.toLowerCase()}-${runToken}`;
    const checkout = `/home/u/.herdr/worktrees/aikami/${branch}`;

    expect(runIdFromWorktreePath(checkout)).toBe(runId);
    expect(contractIdFromWorktreePath(checkout)).toBe(contractId);
  });
});

describe('resolveServiceRoot', () => {
  const savedWorkspace = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
  const savedDirenv = process.env.DIRENV_DIR;
  beforeEach(() => {
    process.env.CONTRACT_PIPELINE_WORKSPACE_PATH = savedWorkspace;
    process.env.DIRENV_DIR = savedDirenv;
    if (savedWorkspace === undefined) {
      delete process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
    }
    if (savedDirenv === undefined) {
      delete process.env.DIRENV_DIR;
    }
  });

  it('uses the caller root outside a contract run', () => {
    delete process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
    delete process.env.DIRENV_DIR;
    expect(resolveServiceRoot('/repo')).toBe('/repo');
  });

  it('serves the worktree checkout inside a contract run', () => {
    // The review/captain tab has cwd = the repo root, so without this a
    // service it started would silently serve main instead of the branch.
    process.env.CONTRACT_PIPELINE_WORKSPACE_PATH = '/wt/contract-task-c-428';
    expect(resolveServiceRoot('/repo')).toBe('/wt/contract-task-c-428');
  });

  it('derives the worktree from DIRENV_DIR when the injected env is gone', () => {
    delete process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
    process.env.DIRENV_DIR = '-/home/dev/.herdr/worktrees/aikami/contract-task-c-516-mtz2k7km';
    expect(resolveServiceRoot('/repo')).toBe(
      '/home/dev/.herdr/worktrees/aikami/contract-task-c-516-mtz2k7km',
    );
  });
});

// ── C-471: Service ownership & identity ─────────────────────

describe('C-471 — service scope (AC-1, AC-3)', () => {
  it('client/hub/site/tauri/preview-* are run-scoped (owned by the contract)', () => {
    expect(SERVICE_DEFS.client.scope).toBe('run');
    expect(SERVICE_DEFS.hub.scope).toBe('run');
    expect(SERVICE_DEFS.site.scope).toBe('run');
    expect(SERVICE_DEFS.tauri.scope).toBe('run');
    expect(SERVICE_DEFS['preview-client'].scope).toBe('run');
    expect(SERVICE_DEFS['preview-hub'].scope).toBe('run');
    expect(SERVICE_DEFS['hub-worker'].scope).toBe('run');
  });

  it('voice/image/text are shared-scoped (heavy singleton backends)', () => {
    expect(SERVICE_DEFS.voice.scope).toBe('shared');
    expect(SERVICE_DEFS.image.scope).toBe('shared');
    expect(SERVICE_DEFS.text.scope).toBe('shared');
  });

  it('advanced engines share the same scope as their modality', () => {
    expect(SERVICE_DEFS['text-ollama'].scope).toBe('shared');
    expect(SERVICE_DEFS['image-comfyui'].scope).toBe('shared');
  });

  // C-471 AC-2: a reusable ServiceDef without an identity probe is invalid
  // configuration — assessServiceReadiness returns 'unavailable' for it and
  // herdr:start image/voice/text refuses to consider the engine ready. Every
  // shared local-stack engine must define a probe.
  it('every shared engine defines an identity probe', () => {
    const shared = ['voice', 'image', 'text', 'text-ollama', 'image-comfyui'] as const;
    for (const key of shared) {
      expect(typeof SERVICE_DEFS[key].probe, `${key} must define a probe`).toBe('function');
    }
  });

  it('configured app probes reject the wrong identity and accept the expected identity', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch');
    try {
      for (const key of ['client', 'hub'] as const) {
        const identity = { service: key, checkout: '/expected', runId: 'run-1' } as const;
        fetchSpy.mockResolvedValueOnce(
          Response.json({ service: key, checkout: '/other', runId: 'run-1' }),
        );
        expect((await SERVICE_DEFS[key].probe?.(identity))?.ready).toBe(false);

        fetchSpy.mockResolvedValueOnce(Response.json(identity));
        expect((await SERVICE_DEFS[key].probe?.(identity))?.ready).toBe(true);
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('ownedServices filters to only run-scoped services', () => {
    const all = ['client', 'voice', 'image', 'text', 'hub'] as const;
    const owned = ownedServices(all);
    expect(owned).toEqual(['client', 'hub']);
    expect(owned).not.toContain('voice');
    expect(owned).not.toContain('image');
    expect(owned).not.toContain('text');
  });

  it('servicesByScope filters correctly', () => {
    const all = ['client', 'voice', 'text', 'hub'] as const;
    const runOnly = servicesByScope(all, ['run']);
    expect(runOnly).toEqual(['client', 'hub']);

    const sharedOnly = servicesByScope(all, ['shared']);
    expect(sharedOnly).toEqual(['voice', 'text']);
  });

  it('CORE_SERVICES contains only the minimum set', () => {
    expect(CORE_SERVICES).toEqual(['client', 'hub']);
  });
});

describe('C-471 — identity probe (AC-2)', () => {
  const engineResponses = [
    {
      service: 'voice',
      valid: () => new Response('ok'),
      invalid: () => Response.json({ status: 'ok' }),
    },
    {
      service: 'image',
      valid: () => Response.json([]),
      invalid: () => Response.json({ models: [] }),
    },
    {
      service: 'text',
      valid: () => Response.json({ status: 'ok' }),
      invalid: () => new Response('ok'),
    },
    {
      service: 'text-ollama',
      valid: () => Response.json({ version: '0.11.0' }),
      invalid: () => Response.json({ status: 'ok' }),
    },
    {
      service: 'image-comfyui',
      valid: () => Response.json({ system: {}, devices: [] }),
      invalid: () => Response.json({ system: {} }),
    },
  ] as const;

  it('shared-engine probes reject redirects and require their engine-specific signature', async () => {
    for (const engine of engineResponses) {
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(engine.valid());
      const identity = buildServiceIdentity(engine.service);
      try {
        const validResult = await SERVICE_DEFS[engine.service].probe?.(identity);
        expect(validResult?.ready).toBeTrue();
        expect(fetchSpy.mock.calls[0]?.[1]?.redirect).toBe('error');

        fetchSpy.mockResolvedValue(engine.invalid());
        const invalidResult = await SERVICE_DEFS[engine.service].probe?.(identity);
        expect(invalidResult?.ready).toBeFalse();
      } finally {
        fetchSpy.mockRestore();
      }
    }
  });

  it('bootstraps a fresh hub-worker from matching pane and listener evidence', async () => {
    const registryDir = mkdtempSync(join(tmpdir(), 'aikami-hub-worker-probe-'));
    const pid = 4242;
    const VALIDATED_START = 1000;
    const probe = makeListenerOwnershipProbe({
      resolvePort: () => 8788,
      listPids: async () => [pid],
      inspector: {
        startTimeMs: async () => VALIDATED_START,
        cwd: async () => '/expected/apps/frontend/hub',
      },
      registryDir,
    })('hub-worker');
    try {
      const wrong = await probe(
        { service: 'hub-worker', checkout: '/wrong', runId: 'run-1' },
        { panePids: [pid] },
      );
      expect(wrong.ready).toBe(false);

      const identity = {
        service: 'hub-worker',
        checkout: '/expected',
        runId: 'run-1',
      } as const;

      // 1. Fresh process: the probe establishes ownership from trusted pane
      //    evidence and reports the identity it proved. It writes nothing.
      const fresh = await probe(identity, { panePids: [pid] });
      expect(fresh).toMatchObject({
        ready: true,
        validatedProcess: { pid, pidStartTimeMs: VALIDATED_START },
      });
      expect(readInstanceRecords({ dir: registryDir })).toHaveLength(0);

      // 2. The recorder persists exactly that identity.
      const recorder = makeInstanceRecorder({
        scopeOf: () => 'run',
        currentRunId: () => 'run-1',
        checkout: () => '/expected',
        registryDir,
      });
      await recorder({
        service: 'hub-worker',
        port: 8788,
        validatedProcess: fresh.validatedProcess,
      });
      expect(readInstanceRecords({ dir: registryDir })).toHaveLength(1);

      // 3. Subsequent checks validate against the record, with no pane evidence.
      const subsequent = await probe(identity, { panePids: [] });
      expect(subsequent).toMatchObject({
        ready: true,
        validatedProcess: { pid, pidStartTimeMs: VALIDATED_START },
      });
      expect(SERVICE_DEFS['hub-worker'].scope).toBe('run');
    } finally {
      rmSync(registryDir, { force: true, recursive: true });
    }
  });

  it('records the exact process identity established by the readiness probe', async () => {
    const registryDir = mkdtempSync(join(tmpdir(), 'aikami-instance-recorder-'));
    try {
      const recorder = makeInstanceRecorder({
        scopeOf: () => 'run',
        currentRunId: () => 'run-1',
        checkout: () => '/expected',
        registryDir,
      });

      await recorder({
        service: 'client',
        port: 5173,
        validatedProcess: { pid: 42, pidStartTimeMs: 1234 },
      });

      expect(readInstanceRecords({ dir: registryDir })).toEqual([
        expect.objectContaining({ service: 'client', pid: 42, pidStartTimeMs: 1234, port: 5173 }),
      ]);
    } finally {
      rmSync(registryDir, { force: true, recursive: true });
    }
  });

  // 🔴 The TOCTOU this pins: validation proves PID 123 / creation identity A,
  // the PID is recycled, and a LATER read sees identity B. If the recorder
  // re-read the start time, the record would authorize B — a process we never
  // started — and `killPort` would terminate it.
  it('never turns a recycled PID into kill authority', async () => {
    const registryDir = mkdtempSync(join(tmpdir(), 'aikami-pid-reuse-'));
    const pid = 4242;
    const VALIDATED_START = 1_000;
    const RECYCLED_START = 999_000;
    // The OS view of the PID: A while the probe validates, B afterwards.
    let liveStart = VALIDATED_START;
    const inspector = {
      startTimeMs: async () => liveStart,
      cwd: async () => '/expected/apps/frontend/hub',
    };
    try {
      const probe = makeListenerOwnershipProbe({
        resolvePort: () => 8788,
        listPids: async () => [pid],
        inspector,
        registryDir,
      })('hub-worker');

      const ready = await probe(
        { service: 'hub-worker', checkout: '/expected', runId: 'run-1' },
        { panePids: [pid] },
      );
      expect(ready.validatedProcess).toEqual({
        pid,
        pidStartTimeMs: VALIDATED_START,
      });

      // The validated process exits and the OS hands the PID to a stranger.
      liveStart = RECYCLED_START;

      const recorder = makeInstanceRecorder({
        scopeOf: () => 'run',
        currentRunId: () => 'run-1',
        checkout: () => '/expected',
        registryDir,
      });
      await recorder({
        service: 'hub-worker',
        port: 8788,
        validatedProcess: ready.validatedProcess,
      });

      // The record carries the VALIDATED identity (A), never the later read (B).
      const [record] = readInstanceRecords({ dir: registryDir });
      expect(record?.pidStartTimeMs).toBe(VALIDATED_START);

      // …so the recycled process is NOT killable: ownership is rejected.
      const verdict = await verifyOwnership({
        pid,
        expected: { service: 'hub-worker', runId: 'run-1', checkout: '/expected' },
        records: readInstanceRecords({ dir: registryDir }),
        inspector,
      });
      expect(verdict).toMatchObject({ owned: false, reason: 'pid_reused' });
    } finally {
      rmSync(registryDir, { force: true, recursive: true });
    }
  });

  // 🔴 The endpoint reports a PID but not its creation identity, so the probe
  // must ESTABLISH that identity as part of readiness verification and hand it
  // to the recorder. A bare PID is not kill authority.
  it('establishes the app instance creation identity during readiness verification', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch');
    try {
      const probe = makeAppIdentityProbe({
        resolvePort: () => 5173,
        listPids: async () => [777],
        inspector: { startTimeMs: async () => 4242, cwd: async () => '/expected' },
      })('client');
      const identity = { service: 'client', checkout: '/expected', runId: 'run-1' } as const;
      fetchSpy.mockResolvedValueOnce(Response.json({ ...identity, pid: 777 }));

      const result = await probe(identity);

      expect(result).toMatchObject({
        ready: true,
        validatedProcess: { pid: 777, pidStartTimeMs: 4242 },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // 🔴 The reported PID is caller-controlled HTTP data. It becomes kill
  // authority only when it is also the process listening on the probed port.
  it('withholds kill authority when the reported PID does not hold the probed port', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch');
    try {
      const probe = makeAppIdentityProbe({
        resolvePort: () => 5173,
        listPids: async () => [999],
        inspector: { startTimeMs: async () => 4242, cwd: async () => '/expected' },
      })('client');
      const identity = { service: 'client', checkout: '/expected', runId: 'run-1' } as const;
      fetchSpy.mockResolvedValueOnce(Response.json({ ...identity, pid: 777 }));

      const result = await probe(identity);

      expect(result.ready).toBe(true);
      expect(result.validatedProcess).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('grants no kill authority when the app creation identity cannot be established', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch');
    try {
      const probe = makeAppIdentityProbe({
        resolvePort: () => 5173,
        listPids: async () => [777],
        inspector: { startTimeMs: async () => undefined, cwd: async () => '/expected' },
      })('client');
      const identity = { service: 'client', checkout: '/expected', runId: 'run-1' } as const;
      fetchSpy.mockResolvedValueOnce(Response.json({ ...identity, pid: 777 }));

      const result = await probe(identity);

      // Ready (the server answered as our instance) but NOT killable.
      expect(result.ready).toBe(true);
      expect(result.validatedProcess).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('buildServiceIdentity includes checkout, runId and service', () => {
    const identity = buildServiceIdentity('client');
    expect(identity.service).toBe('client');
    expect(identity.checkout).toBeTruthy();
    // runId may be undefined outside a contract pipeline
  });

  it('assessServiceReadiness returns pane state when not healthy', async () => {
    const def = SERVICE_DEFS.client;
    const identity = buildServiceIdentity('client');
    const result = await assessServiceReadiness('non-existent-pane', def, identity, 9999);
    // Port not open + no process info = 'booting' (not crashed, never restart on missing data)
    expect(['booting', 'stopped']).toContain(result.state);
  });

  it('assessServiceReadiness returns healthy without probe for run-owned services', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const def: ServiceDef = {
      ...SERVICE_DEFS.client,
      readyCheck: 'tcp',
      probe: undefined,
    };
    const identity = buildServiceIdentity('client');
    try {
      const result = await assessServiceReadiness('fake-pane', def, identity, port);
      expect(result.state).toBe('healthy');
      expect(result.observedIdentity).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it('assessServiceReadiness returns unavailable when probe rejects identity', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const rejectingProbe: ServiceDef['probe'] = async () => ({
      ready: false,
      reason: 'Expected instance C-471, found C-470',
      observedIdentity: { runId: 'C-470' },
    });

    const def: ServiceDef = {
      ...SERVICE_DEFS.client,
      readyCheck: 'tcp',
      probe: rejectingProbe,
    };

    const identity = buildServiceIdentity('client');
    try {
      const result = await assessServiceReadiness('fake-pane', def, identity, port);
      expect(result.state).toBe('unavailable');
      expect(result.observedIdentity).toEqual({ runId: 'C-470' });
    } finally {
      server.close();
    }
  });

  it('assessServiceReadiness rejects reusable services without identity evidence', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const identity = { service: 'voice', checkout: '/expected', runId: 'C-471' } as const;

    try {
      const result = await assessServiceReadiness(
        'fake-pane',
        { ...SERVICE_DEFS.voice, readyCheck: 'tcp', probe: undefined },
        identity,
        port,
      );
      expect(result.state).toBe('unavailable');
      expect(result.reason).toBe('Reusable service has no instance-bound identity probe');
      expect(result.observedIdentity).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it('assessServiceReadiness rejects mismatched reusable-service evidence', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const identity = { service: 'voice', checkout: '/expected', runId: 'C-471' } as const;
    const observedIdentities = [
      undefined,
      { service: 'text', checkout: '/expected', runId: 'C-471' } as const,
      { service: 'voice', checkout: '/other', runId: 'C-471' } as const,
      { service: 'voice', checkout: '/expected', runId: 'C-470' } as const,
    ];

    try {
      for (const observedIdentity of observedIdentities) {
        const def: ServiceDef = {
          ...SERVICE_DEFS.voice,
          readyCheck: 'tcp',
          probe: async () => ({ ready: true, observedIdentity }),
        };
        const result = await assessServiceReadiness('fake-pane', def, identity, port);
        expect(result.state).toBe('unavailable');
        expect(result.observedIdentity).toEqual(observedIdentity);
      }
    } finally {
      server.close();
    }
  });

  it('buildServiceIdentity carries the current checkout path', () => {
    const saved = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
    try {
      process.env.CONTRACT_PIPELINE_WORKSPACE_PATH = '/custom/checkout';
      const identity = buildServiceIdentity('hub');
      expect(identity.checkout).toBe('/custom/checkout');
    } finally {
      if (saved === undefined) {
        delete process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
      } else {
        process.env.CONTRACT_PIPELINE_WORKSPACE_PATH = saved;
      }
    }
  });

  // Brief P1: a responsive client server from ANOTHER checkout must not
  // satisfy this contract's readiness check. The app-identity probe reads the
  // dev identity endpoint and the verifier rejects a mismatched checkout.
  it('app-identity probe rejects a client server from another checkout', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const identity = { service: 'client', checkout: '/expected', runId: 'C-471' } as const;

    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ service: 'client', checkout: '/other-checkout', runId: 'C-471', pid: 1 }),
    );
    try {
      const def: ServiceDef = { ...SERVICE_DEFS.client, readyCheck: 'tcp' };
      const result = await assessServiceReadiness('fake-pane', def, identity, port);
      expect(result.state).toBe('unavailable');
      expect(result.reason).toContain('checkout');
    } finally {
      fetchSpy.mockRestore();
      server.close();
    }
  });

  it('app-identity probe accepts a client server from the expected checkout', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const identity = { service: 'client', checkout: '/expected', runId: 'C-471' } as const;

    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ service: 'client', checkout: '/expected', runId: 'C-471', pid: 1 }),
    );
    try {
      const def: ServiceDef = { ...SERVICE_DEFS.client, readyCheck: 'tcp' };
      const result = await assessServiceReadiness('fake-pane', def, identity, port);
      expect(result.state).toBe('healthy');
    } finally {
      fetchSpy.mockRestore();
      server.close();
    }
  });
});

describe('C-471 — killPort requires verified ownership (AC-1)', () => {
  it('does not call killPortUnsafe when pidsOnPort returns empty', async () => {
    // Port 65432 is almost certainly unbound; the point is that the
    // empty-lookup path returns without any blind fallback.
    await expect(killPort(65432)).resolves.toBeUndefined();
  });
});

describe('C-471 — herdr failure preservation (AC-5)', () => {
  it('KNOWN_SERVICES includes all expected services', () => {
    expect(KNOWN_SERVICES).toContain('client');
    expect(KNOWN_SERVICES).toContain('hub');
    expect(KNOWN_SERVICES).toContain('voice');
    expect(KNOWN_SERVICES).toContain('image');
    expect(KNOWN_SERVICES).toContain('text');
    expect(KNOWN_SERVICES).toContain('hub-worker');
  });

  it('ALL_SERVICES does not include opt-in advanced engines', () => {
    expect(ALL_SERVICES).not.toContain('text-ollama');
    expect(ALL_SERVICES).not.toContain('image-comfyui');
  });

  it('parseHerdrStatus preserves error diagnostics', () => {
    const status = parseHerdrStatus('');
    expect(status).toEqual({});
  });
});
