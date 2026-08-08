// apps/frontend/hub/src/lib/client/services/dataconnect/__tests__/persona_mapper.test.ts
//
// Unit tests for the Data Connect persona mapper (row ↔ PersonaData) and the
// repository error mapping. The mapper is pure TS (no runes, no Firebase
// imports beyond types) so it tests cleanly under `bun test`.
import { describe, expect, test } from 'bun:test';
import {
  mapDataConnectError,
  mergeUpdateFields,
  type PersonaRow,
  rowToData,
  toCreateRow,
  toUpdateRow,
} from '../persona_mapper.ts';

const makeRow = (overrides: Partial<PersonaRow> = {}): PersonaRow => ({
  id: 'persona_123',
  createdAt: '2026-08-07T10:00:00.000Z',
  updatedAt: '2026-08-07T11:30:00.000Z',
  name: 'Kaelen',
  description: 'A stoic dwarf',
  avatarUrl: 'https://example.com/avatar.png',
  uid: 'user-1',
  traits: {
    race: 'Dwarf',
    class: 'Fighter',
    level: 7,
    abilityScores: { strength: 16 },
    // A stale writer could have left these inside traits — they must not
    // override the top-level columns and must not leak into PersonaData.
    name: 'WRONG-NAME',
    voiceConfigId: 'WRONG-VOICE',
    priority: 99,
  },
  isActive: true,
  voiceConfigId: 'voice-42',
  ...overrides,
});

describe('rowToData', () => {
  test('flattens traits back to top-level sheet fields', () => {
    const data = rowToData(makeRow());

    expect(data.id).toBe('persona_123');
    expect(data.name).toBe('Kaelen');
    expect(data.uid).toBe('user-1');
    expect(data.isActive).toBe(true);
    expect(data.avatarUrl).toBe('https://example.com/avatar.png');
    expect(data.voiceConfigId).toBe('voice-42');
    // Sheet fields come from traits...
    expect(data.race).toBe('Dwarf');
    expect(data.class).toBe('Fighter');
    expect(data.level).toBe(7);
    expect(data.abilityScores).toEqual({ strength: 16 });
  });

  test('converts RFC 3339 timestamps to epoch ms', () => {
    const data = rowToData(makeRow());

    expect(data.createdAt).toBe(Date.parse('2026-08-07T10:00:00.000Z'));
    expect(data.updatedAt).toBe(Date.parse('2026-08-07T11:30:00.000Z'));
  });

  test('never lets stale scalar columns inside traits override the row columns', () => {
    const data = rowToData(makeRow());

    expect(data.name).toBe('Kaelen');
    expect(data.voiceConfigId).toBe('voice-42');
    expect((data as Record<string, unknown>).priority).toBeUndefined();
    expect((data as Record<string, unknown>).description).toBeUndefined();
  });

  test('drops description (not part of PersonaData)', () => {
    const data = rowToData(makeRow());

    expect((data as Record<string, unknown>).description).toBeUndefined();
  });

  test('handles null traits and null optional scalars', () => {
    const data = rowToData(
      makeRow({ traits: null, avatarUrl: null, voiceConfigId: null, isActive: false }),
    );

    expect(data.race).toBeUndefined();
    expect(data.avatarUrl).toBeUndefined();
    expect(data.voiceConfigId).toBeUndefined();
    expect(data.isActive).toBe(false);
  });
});

describe('toCreateRow', () => {
  test('keeps name in the name column and sheet fields in traits', () => {
    const vars = toCreateRow({
      id: 'persona_new',
      uid: 'user-1',
      data: {
        name: 'Lyra',
        race: 'Elf',
        class: 'Ranger',
        level: 3,
        isActive: false,
        voiceConfigId: 'voice-9',
        avatarUrl: 'https://example.com/lyra.png',
      },
    });

    expect(vars.id).toBe('persona_new');
    expect(vars.uid).toBe('user-1');
    expect(vars.name).toBe('Lyra');
    expect(vars.isActive).toBe(false);
    expect(vars.avatarUrl).toBe('https://example.com/lyra.png');
    expect(vars.voiceConfigId).toBe('voice-9');
    // name / voiceConfigId / avatarUrl must NOT be duplicated inside traits.
    expect(vars.traits).toEqual({ race: 'Elf', class: 'Ranger', level: 3 });
  });

  test('never sends timestamps (server-set on insert)', () => {
    const vars = toCreateRow({
      id: 'persona_new',
      uid: 'user-1',
      data: { name: 'Bare', isActive: false },
    });

    expect(vars.traits).toEqual({});
    expect('createdAt' in vars).toBe(false);
    expect('updatedAt' in vars).toBe(false);
  });
});

describe('toUpdateRow', () => {
  test('maps merged data with the same column/traits boundary', () => {
    const vars = toUpdateRow({
      uid: 'user-1',
      personaId: 'persona_123',
      data: {
        id: 'persona_123',
        createdAt: 1,
        updatedAt: 2,
        name: 'Kaelen II',
        race: 'Dwarf',
        class: 'Cleric',
        isActive: true,
        voiceConfigId: 'voice-42',
        avatarUrl: 'https://example.com/avatar.png',
      },
    });

    expect(vars.id).toBe('persona_123');
    expect(vars.uid).toBe('user-1');
    expect(vars.name).toBe('Kaelen II');
    expect(vars.voiceConfigId).toBe('voice-42');
    expect(vars.avatarUrl).toBe('https://example.com/avatar.png');
    expect(vars.traits).toEqual({ race: 'Dwarf', class: 'Cleric' });
  });

  test('does not include ownership/activation fields in traits', () => {
    const vars = toUpdateRow({
      uid: 'user-1',
      personaId: 'persona_123',
      data: {
        id: 'persona_123',
        createdAt: 1,
        updatedAt: 2,
        name: 'X',
        isActive: true,
        uid: 'user-1',
      },
    });

    expect('isActive' in (vars.traits as Record<string, unknown>)).toBe(false);
    expect('uid' in (vars.traits as Record<string, unknown>)).toBe(false);
  });
});

describe('mergeUpdateFields', () => {
  test('merges partial update fields over the existing data', () => {
    const existing = rowToData(makeRow());
    const merged = mergeUpdateFields(existing, { class: 'Paladin' });

    expect(merged.name).toBe('Kaelen');
    expect(merged.class).toBe('Paladin');
    expect(merged.race).toBe('Dwarf');
  });

  test('skips undefined fields (a partial update never clears untouched fields)', () => {
    const existing = rowToData(makeRow());
    const merged = mergeUpdateFields(existing, { avatarUrl: undefined, class: 'Paladin' });

    expect(merged.avatarUrl).toBe('https://example.com/avatar.png');
    expect(merged.class).toBe('Paladin');
  });
});

describe('mapDataConnectError', () => {
  const appErrorType = (error: Error): unknown => {
    const cause = error.cause as { errorType?: unknown } | undefined;
    return cause?.errorType;
  };

  test('maps unauthenticated SDK codes to unauthenticated domain errors', () => {
    const error = new Error('Request is missing an authentication token');
    (error as unknown as { code: string }).code = 'unauthorized';

    const mapped = mapDataConnectError('create', error);

    expect(appErrorType(mapped)).toBe('unauthenticated');
  });

  test('maps duplicate-id / unique-violation messages to already-exists (conflict)', () => {
    const error = new Error(
      'violates unique constraint "persona_pkey": duplicate key value violates unique constraint "persona_pkey"',
    );

    const mapped = mapDataConnectError('create', error);

    expect(appErrorType(mapped)).toBe('already-exists');
    expect(mapped.message).toContain('already exists');
  });

  test('maps not-found messages to not-found domain errors', () => {
    const error = new Error('persona not found');

    const mapped = mapDataConnectError('remove', error);

    expect(appErrorType(mapped)).toBe('not-found');
  });

  test('maps anything else to internal without leaking the raw error', () => {
    const error = new Error('ECONNREFUSED 127.0.0.1:9398');

    const mapped = mapDataConnectError('listByOwner', error);

    expect(appErrorType(mapped)).toBe('internal');
    expect(mapped.message).toContain('Persona listByOwner failed');
  });
});
