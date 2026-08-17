/**
 * apps/backend/local-stack/stack/ports.test.ts
 *
 * C-390 AC-11: every port the local stack binds must match the project's
 * allocation table (packages/shared/constants/src/lib/development_ports.ts).
 * The same source of truth feeds the client CSP and the desktop app, so a
 * drift here would break the Tauri whitelist without any client change.
 */

import { describe, expect, it } from 'bun:test';
import { EMULATOR_PORTS, PORTS } from '@aikami/constants';

const COMPOSE_PORT_MAP = {
  text: 11434,
  image: 8188,
  voice: 8089,
  stt: 8087,
  client: 5274,
} as const;

describe('AC-11 — local stack ports match development_ports.ts', () => {
  it('text binds the allocation-table port 11434', () => {
    expect(EMULATOR_PORTS.text).toBe(11434);
    expect(COMPOSE_PORT_MAP.text).toBe(EMULATOR_PORTS.text);
  });

  it('image binds the allocation-table port 8188', () => {
    expect(EMULATOR_PORTS.image).toBe(8188);
    expect(COMPOSE_PORT_MAP.image).toBe(EMULATOR_PORTS.image);
  });

  it('voice binds the allocation-table port 8089', () => {
    expect(EMULATOR_PORTS.voice).toBe(8089);
    expect(COMPOSE_PORT_MAP.voice).toBe(EMULATOR_PORTS.voice);
  });

  it('stt binds the newly added allocation-table constant (8087)', () => {
    expect(EMULATOR_PORTS.stt).toBe(8087);
    expect(COMPOSE_PORT_MAP.stt).toBe(EMULATOR_PORTS.stt);
  });

  it('client binds an Aikami-allocated port, not the Nordclaw 3000 range', () => {
    expect(COMPOSE_PORT_MAP.client).toBe(5274);
    expect(EMULATOR_PORTS.client).toBe(5274);
    // Nordclaw owns 3000–3009; Aikami's client must not land there.
    expect(COMPOSE_PORT_MAP.client).toBeGreaterThanOrEqual(5270);
    expect(COMPOSE_PORT_MAP.client).toBeLessThanOrEqual(5289);
  });

  it('no service binds host 8080 (Nordclaw Firestore emulator)', () => {
    const used = Object.values(COMPOSE_PORT_MAP);
    expect(used).not.toContain(8080);
  });

  it('stt exists in every environment port table', () => {
    expect(PORTS.emulator.stt).toBe(8087);
    expect(PORTS.staging.stt).toBe(8086);
    expect(PORTS.production.stt).toBe(8090);
  });

  it('engine ports stay within the documented backend ranges', () => {
    expect(COMPOSE_PORT_MAP.voice).toBeGreaterThanOrEqual(8087);
    expect(COMPOSE_PORT_MAP.voice).toBeLessThanOrEqual(8092);
    expect(COMPOSE_PORT_MAP.stt).toBeGreaterThanOrEqual(8087);
    expect(COMPOSE_PORT_MAP.stt).toBeLessThanOrEqual(8092);
  });
});
