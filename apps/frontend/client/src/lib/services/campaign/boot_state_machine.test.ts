// apps/frontend/client/src/lib/services/campaign/boot_state_machine.test.ts
//
// Tests for the campaign boot state machine.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine

import { describe, expect, test } from 'bun:test';
import { canTransition, transition } from './boot_state_machine.ts';

describe('transition', () => {
  // ── idle state ──

  test('idle + START_NEW → creating', () => {
    expect(transition('idle', { type: 'START_NEW' })).toBe('creating');
  });

  test('idle + LOAD_REQUESTED → loading', () => {
    expect(transition('idle', { type: 'LOAD_REQUESTED', campaignId: 'c-1' })).toBe('loading');
  });

  test('idle + SETUP_COMPLETE → throw (invalid)', () => {
    expect(() => transition('idle', { type: 'SETUP_COMPLETE' })).toThrow(
      'Invalid transition: cannot SETUP_COMPLETE from state "idle"',
    );
  });

  test('idle + PAUSE → throw (invalid)', () => {
    expect(() => transition('idle', { type: 'PAUSE' })).toThrow();
  });

  // ── creating state ──

  test('creating + PERSONA_SELECTED → creating (idempotent)', () => {
    expect(transition('creating', { type: 'PERSONA_SELECTED', personaId: 'p-1' })).toBe('creating');
  });

  test('creating + SETUP_COMPLETE → playing', () => {
    expect(transition('creating', { type: 'SETUP_COMPLETE' })).toBe('playing');
  });

  test('creating + START_NEW → throw (invalid)', () => {
    expect(() => transition('creating', { type: 'START_NEW' })).toThrow();
  });

  // ── loading state ──

  test('loading + LOAD_COMPLETE → playing', () => {
    expect(transition('loading', { type: 'LOAD_COMPLETE' })).toBe('playing');
  });

  test('loading + LOAD_FAILED → failed', () => {
    expect(transition('loading', { type: 'LOAD_FAILED', error: 'bad data' })).toBe('failed');
  });

  test('loading + SAVE_REQUESTED → throw (cannot save while loading)', () => {
    expect(() => transition('loading', { type: 'SAVE_REQUESTED' })).toThrow();
  });

  // ── playing state ──

  test('playing + PAUSE → paused', () => {
    expect(transition('playing', { type: 'PAUSE' })).toBe('paused');
  });

  test('playing + SAVE_REQUESTED → saving', () => {
    expect(transition('playing', { type: 'SAVE_REQUESTED' })).toBe('saving');
  });

  test('playing + START_NEW → throw (must pause first or fail)', () => {
    expect(() => transition('playing', { type: 'START_NEW' })).toThrow();
  });

  // ── paused state ──

  test('paused + RESUME → playing', () => {
    expect(transition('paused', { type: 'RESUME' })).toBe('playing');
  });

  test('paused + SAVE_REQUESTED → saving', () => {
    expect(transition('paused', { type: 'SAVE_REQUESTED' })).toBe('saving');
  });

  // ── saving state ──

  test('saving + SAVE_COMPLETE → playing', () => {
    expect(transition('saving', { type: 'SAVE_COMPLETE' })).toBe('playing');
  });

  test('saving + SAVE_FAILED → failed', () => {
    expect(transition('saving', { type: 'SAVE_FAILED', error: 'disk full' })).toBe('failed');
  });

  // ── failed state ──

  test('failed + START_NEW → creating (recovery)', () => {
    expect(transition('failed', { type: 'START_NEW' })).toBe('creating');
  });

  test('failed + LOAD_REQUESTED → loading (recovery)', () => {
    expect(transition('failed', { type: 'LOAD_REQUESTED', campaignId: 'c-1' })).toBe('loading');
  });

  test('failed + SETUP_COMPLETE → throw (invalid)', () => {
    expect(() => transition('failed', { type: 'SETUP_COMPLETE' })).toThrow();
  });
});

describe('canTransition', () => {
  test('returns true for valid transitions', () => {
    expect(canTransition('idle', { type: 'START_NEW' })).toBe(true);
    expect(canTransition('playing', { type: 'PAUSE' })).toBe(true);
    expect(canTransition('failed', { type: 'START_NEW' })).toBe(true);
  });

  test('returns false for invalid transitions', () => {
    expect(canTransition('idle', { type: 'SETUP_COMPLETE' })).toBe(false);
    expect(canTransition('playing', { type: 'START_NEW' })).toBe(false);
    expect(canTransition('saving', { type: 'START_NEW' })).toBe(false);
  });
});
