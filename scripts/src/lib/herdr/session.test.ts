// scripts/src/lib/herdr/session.test.ts
import { describe, expect, it } from 'bun:test';
import net from 'node:net';
import {
  ALL_SERVICES,
  expandServices,
  isPortReady,
  KNOWN_SERVICES,
  normalizeService,
  parseHerdrStatus,
  SERVICE_DEFS,
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
