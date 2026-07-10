// packages/frontend/engine/src/__tests__/tag_parser.test.ts
//
// Unit tests for the bridge tag parser. Covers all tag types,
// malformed tags, nested tags, multi-line tags, and edge cases.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import { describe, expect, test } from 'bun:test';
import { parseBridgeTags } from '../tag_parser.ts';

// ---------------------------------------------------------------------------
// AC-2: Core tag parsing
// ---------------------------------------------------------------------------

describe('parseBridgeTags', () => {
  // ── Basic tag extraction ───────────────────────────────────────────

  test('extracts a single <note> tag', () => {
    const result = parseBridgeTags(
      '<note>The wizard warned you about the eastern pass</note> The path looks dangerous.',
    );
    expect(result.cleanContent).toBe('The path looks dangerous.');
    expect(result.notes).toEqual(['The wizard warned you about the eastern pass']);
    expect(result.influences).toEqual([]);
    expect(result.oocContents).toEqual([]);
  });

  test('extracts a single <influence> tag', () => {
    const result = parseBridgeTags(
      'The path ahead looks dangerous. <influence>Make the next NPC suspicious of outsiders</influence>',
    );
    expect(result.cleanContent).toBe('The path ahead looks dangerous.');
    expect(result.notes).toEqual([]);
    expect(result.influences).toEqual(['Make the next NPC suspicious of outsiders']);
    expect(result.oocContents).toEqual([]);
  });

  test('extracts a single <ooc> tag', () => {
    const result = parseBridgeTags(
      'I walk ahead carefully. <ooc>What does my character know about dragons?</ooc>',
    );
    expect(result.cleanContent).toBe('I walk ahead carefully.');
    expect(result.notes).toEqual([]);
    expect(result.influences).toEqual([]);
    expect(result.oocContents).toEqual(['What does my character know about dragons?']);
  });

  // ── Multiple tags ──────────────────────────────────────────────────

  test('extracts multiple tags of the same type', () => {
    const result = parseBridgeTags(
      '<note>First note</note> Some text. <note>Second note</note> More text.',
    );
    expect(result.cleanContent).toBe('Some text. More text.');
    expect(result.notes).toEqual(['First note', 'Second note']);
    expect(result.influences).toEqual([]);
    expect(result.oocContents).toEqual([]);
  });

  test('extracts mixed tag types in one message', () => {
    const result = parseBridgeTags(
      '<note>The wizard warned you</note> The path looks dangerous. <influence>Make the next NPC suspicious</influence> Continue. <ooc>What about dragons?</ooc>',
    );
    expect(result.cleanContent).toBe('The path looks dangerous. Continue.');
    expect(result.notes).toEqual(['The wizard warned you']);
    expect(result.influences).toEqual(['Make the next NPC suspicious']);
    expect(result.oocContents).toEqual(['What about dragons?']);
  });

  // ── No tags ────────────────────────────────────────────────────────

  test('returns input unchanged when no tags present', () => {
    const result = parseBridgeTags('Just a normal message with no tags.');
    expect(result.cleanContent).toBe('Just a normal message with no tags.');
    expect(result.notes).toEqual([]);
    expect(result.influences).toEqual([]);
    expect(result.oocContents).toEqual([]);
  });

  test('handles empty string', () => {
    const result = parseBridgeTags('');
    expect(result.cleanContent).toBe('');
    expect(result.notes).toEqual([]);
    expect(result.influences).toEqual([]);
    expect(result.oocContents).toEqual([]);
  });

  // ── Malformed tags (missing closing) ───────────────────────────────

  test('handles malformed <note> — treats rest as content', () => {
    const result = parseBridgeTags('<note>no closing tag here');
    expect(result.cleanContent).toBe('');
    expect(result.notes).toEqual(['no closing tag here']);
  });

  test('handles malformed <note> — with preceding text', () => {
    const result = parseBridgeTags('Before text. <note>no closing');
    expect(result.cleanContent).toBe('Before text.');
    expect(result.notes).toEqual(['no closing']);
  });

  test('handles malformed <influence> — treats rest as content', () => {
    const result = parseBridgeTags('<influence>Make it rain');
    expect(result.cleanContent).toBe('');
    expect(result.influences).toEqual(['Make it rain']);
  });

  test('handles malformed <ooc> — treats rest as content', () => {
    const result = parseBridgeTags('<ooc>question here');
    expect(result.cleanContent).toBe('');
    expect(result.oocContents).toEqual(['question here']);
  });

  // ── Empty tags ─────────────────────────────────────────────────────

  test('handles empty <note></note> — extracts empty string', () => {
    const result = parseBridgeTags('<note></note> Text here.');
    expect(result.cleanContent).toBe('Text here.');
    expect(result.notes).toEqual(['']);
  });

  test('handles empty <influence></influence> — extracts empty string', () => {
    const result = parseBridgeTags('<influence></influence> Text here.');
    expect(result.cleanContent).toBe('Text here.');
    expect(result.influences).toEqual(['']);
  });

  test('handles empty <ooc></ooc> — ignores (no content)', () => {
    const result = parseBridgeTags('<ooc></ooc> Text here.');
    expect(result.cleanContent).toBe('Text here.');
    expect(result.oocContents).toEqual([]);
  });

  // ── Multi-line tags ────────────────────────────────────────────────

  test('handles multi-line tag content', () => {
    const result = parseBridgeTags('<note>First line\nSecond line\nThird line</note> Normal text.');
    expect(result.cleanContent).toBe('Normal text.');
    expect(result.notes).toEqual(['First line\nSecond line\nThird line']);
  });

  // ── Nested tags ────────────────────────────────────────────────────

  test('extracts outer tag only when tags are nested', () => {
    const result = parseBridgeTags('<note>content with <influence>inner</influence> inside</note>');
    expect(result.cleanContent).toBe('');
    expect(result.notes).toEqual(['content with <influence>inner</influence> inside']);
    expect(result.influences).toEqual([]);
  });

  test('handles deeply nested tags — outer note wins', () => {
    const result = parseBridgeTags(
      '<note>outer <influence>mid <ooc>inner</ooc></influence> text</note>',
    );
    expect(result.cleanContent).toBe('');
    expect(result.notes).toEqual(['outer <influence>mid <ooc>inner</ooc></influence> text']);
    expect(result.influences).toEqual([]);
    expect(result.oocContents).toEqual([]);
  });

  // ── Case insensitivity ─────────────────────────────────────────────

  test('handles uppercase tag names', () => {
    const result = parseBridgeTags('<NOTE>Upper case</NOTE> <INFLUENCE>test</INFLUENCE>');
    expect(result.cleanContent).toBe('');
    expect(result.notes).toEqual(['Upper case']);
    expect(result.influences).toEqual(['test']);
  });

  test('handles mixed case closing tags', () => {
    const result = parseBridgeTags('<note>content</NOTE>');
    expect(result.cleanContent).toBe('');
    expect(result.notes).toEqual(['content']);
  });

  // ── Non-bridge tags ignored ────────────────────────────────────────

  test('ignores non-bridge angle-bracket content', () => {
    const result = parseBridgeTags('This is <bold>styled</bold> text.');
    expect(result.cleanContent).toBe('This is <bold>styled</bold> text.');
    expect(result.notes).toEqual([]);
    expect(result.influences).toEqual([]);
    expect(result.oocContents).toEqual([]);
  });

  // ── Consecutive tags ───────────────────────────────────────────────

  test('handles consecutive tags without text between them', () => {
    const result = parseBridgeTags('<note>Note A</note><influence>Influence B</influence>');
    expect(result.cleanContent).toBe('');
    expect(result.notes).toEqual(['Note A']);
    expect(result.influences).toEqual(['Influence B']);
  });

  test('handles tags adjacent to text', () => {
    const result = parseBridgeTags('<note>Tip</note>Text <influence>Push</influence> End');
    expect(result.cleanContent).toBe('Text End');
    expect(result.notes).toEqual(['Tip']);
    expect(result.influences).toEqual(['Push']);
  });

  // ── Whitespace handling ────────────────────────────────────────────

  test('collapses extra whitespace from tag removal', () => {
    const result = parseBridgeTags('Start.  <note>middle</note>  End.');
    expect(result.cleanContent).toBe('Start. End.');
    expect(result.notes).toEqual(['middle']);
  });

  // ── Multiple OOC tags ──────────────────────────────────────────────

  test('extracts multiple <ooc> tags', () => {
    const result = parseBridgeTags(
      '<ooc>First question</ooc> Game text. <ooc>Second question</ooc>',
    );
    expect(result.cleanContent).toBe('Game text.');
    expect(result.oocContents).toEqual(['First question', 'Second question']);
  });

  test('ignores empty OOC tags but fills others', () => {
    const result = parseBridgeTags('<ooc></ooc><ooc>valid</ooc>');
    expect(result.oocContents).toEqual(['valid']);
  });

  // ── AC-2 example from contract ─────────────────────────────────────

  test('matches the contract example exactly', () => {
    const result = parseBridgeTags(
      '<note>The wizard warned you about the eastern pass</note> The path ahead looks dangerous. <influence>Make the next NPC suspicious of outsiders</influence>',
    );
    expect(result.cleanContent).toBe('The path ahead looks dangerous.');
    expect(result.notes).toEqual(['The wizard warned you about the eastern pass']);
    expect(result.influences).toEqual(['Make the next NPC suspicious of outsiders']);
    expect(result.oocContents).toEqual([]);
  });
});
