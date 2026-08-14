// scripts/src/lib/herdr/session.test.ts
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { posixQuote, which } from '../env/which.ts';
import {
  ALL_SERVICES,
  assertNoPortConflicts,
  assertNoRunningServiceConflicts,
  expandServices,
  isPortReady,
  KNOWN_SERVICES,
  normalizeService,
  parseHerdrStatus,
  resolveReadyPort,
  SERVICE_DEFS,
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

  it('client/hub/site/firebase still shift by the offset', () => {
    const offset = 1930;
    expect(resolveReadyPort('client', 'emulator', offset)).toBe(5274 + offset);
    expect(resolveReadyPort('hub', 'emulator', offset)).toBe(5276 + offset);
    expect(resolveReadyPort('site', 'emulator', offset)).toBe(5280 + offset);
    expect(resolveReadyPort('firebase', 'emulator', offset)).toBe(9098 + offset);
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

describe('wrapCommand', () => {
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
