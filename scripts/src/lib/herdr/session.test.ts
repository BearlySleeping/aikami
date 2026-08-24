// scripts/src/lib/herdr/session.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { resetDirenvCache } from '../env/direnv_detect.ts';
import { posixQuote, which } from '../env/which.ts';
import {
  ALL_SERVICES,
  assertNoPortConflicts,
  assertNoRunningServiceConflicts,
  buildServiceCommand,
  buildSessionName,
  CONTRACT_WORKSPACE_PREFIX,
  contractIdFromSessionName,
  expandServices,
  isKillableProcess,
  isPortReady,
  KNOWN_SERVICES,
  normalizeService,
  parseHerdrStatus,
  parseWorkspaceName,
  portsToCleanupForService,
  resolveReadyPort,
  resolveServiceRoot,
  SERVICE_DEFS,
  serviceEnvArgs,
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

describe('postgres herdr service (C-387)', () => {
  it('registers postgres in SERVICE_DEFS', () => {
    expect(SERVICE_DEFS.postgres.name).toBe('postgres');
  });

  it('exposes an emulator-only readyPort of 5433', () => {
    expect(SERVICE_DEFS.postgres.readyPort?.('emulator')).toBe(5433);
    expect(SERVICE_DEFS.postgres.readyPort?.('staging')).toBeUndefined();
    expect(SERVICE_DEFS.postgres.readyPort?.('production')).toBeUndefined();
  });

  it('uses the raw-TCP readiness probe (postgres is not HTTP)', () => {
    expect(SERVICE_DEFS.postgres.readyCheck).toBe('tcp');
  });

  it('accepts postgres as a service name', () => {
    expect(normalizeService('postgres')).toBe('postgres');
  });

  it('does not add postgres to the all group (out of scope)', () => {
    expect(ALL_SERVICES).not.toContain('postgres');
    expect(expandServices(['all'])).not.toContain('postgres');
  });

  it('includes postgres among the known/listed services', () => {
    expect(KNOWN_SERVICES).toContain('postgres');
  });
});

describe('isKillableProcess', () => {
  it('allows killing our own dev-server process names', () => {
    expect(isKillableProcess('node')).toBe(true);
    expect(isKillableProcess('bun')).toBe(true);
    expect(isKillableProcess('vite')).toBe(true);
  });

  it('still refuses an unrelated bystander process', () => {
    expect(isKillableProcess('explorer.exe')).toBe(false);
    expect(isKillableProcess('chrome.exe')).toBe(false);
  });
});

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
    expect(wrapped).not.toContain('-c');
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

describe('resolveServiceRoot', () => {
  const saved = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
  beforeEach(() => {
    process.env.CONTRACT_PIPELINE_WORKSPACE_PATH = saved;
    if (saved === undefined) {
      delete process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
    }
  });

  it('uses the caller root outside a contract run', () => {
    delete process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
    expect(resolveServiceRoot('/repo')).toBe('/repo');
  });

  it('serves the worktree checkout inside a contract run', () => {
    // The review/captain tab has cwd = the repo root, so without this a
    // service it started would silently serve main instead of the branch.
    process.env.CONTRACT_PIPELINE_WORKSPACE_PATH = '/wt/contract-task-c-428';
    expect(resolveServiceRoot('/repo')).toBe('/wt/contract-task-c-428');
  });
});
