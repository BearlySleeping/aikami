// apps/frontend/client/src/lib/services/expression/keyword_detection.test.ts
//
// Unit tests for Tier 2 keyword-based expression detection.
// Tests keyword regex compilation and priority matching directly
// against the expression catalog — no service imports needed.
//
// Contract: C-239 Expression Emotion System

import { describe, expect, test } from 'bun:test';
import { EXPRESSION_CATALOG, getKeywordRegex } from '$lib/data/expression_catalog';
import type { ExpressionId } from '$types/expression';

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Scans message text against catalog keyword patterns.
 * First match by position wins. Ties fall back to neutral.
 */
const scanKeywords = (message: string): ExpressionId => {
  let best: ExpressionId = 'neutral';
  let bestPos = Number.POSITIVE_INFINITY;
  let tieDetected = false;

  for (const entry of EXPRESSION_CATALOG) {
    const regex = getKeywordRegex(entry.id);
    regex.lastIndex = 0;
    const match = regex.exec(message);
    if (!match) {
      continue;
    }

    const pos = match.index;

    if (pos < bestPos) {
      bestPos = pos;
      best = entry.id;
      tieDetected = false;
    } else if (pos === bestPos) {
      tieDetected = true;
    }
  }

  return tieDetected ? 'neutral' : best;
};

// ── Tests ────────────────────────────────────────────────────────────────

describe('Keyword detection (Tier 2)', () => {
  test('detects happy from smile keywords', () => {
    expect(scanKeywords('She smiles warmly at the hero.')).toBe('happy');
  });

  test('detects angry from fury keywords', () => {
    expect(scanKeywords('He snarls with fury, eyes blazing.')).toBe('angry');
  });

  test('detects sad from tears keywords', () => {
    expect(scanKeywords('She weeps softly, tears streaming down her face.')).toBe('sad');
  });

  test('detects surprised from gasp keywords', () => {
    expect(scanKeywords('He gasps in astonishment at the sight before him.')).toBe('surprised');
  });

  test('returns neutral for text with no matching keywords', () => {
    expect(scanKeywords('The merchant counts his coins carefully.')).toBe('neutral');
  });

  test('first match in text wins over later matches', () => {
    expect(scanKeywords('He snarls with fury at first, but then he smiles.')).toBe('angry');
  });

  test('returns neutral for empty message', () => {
    expect(scanKeywords('')).toBe('neutral');
  });

  test('detects fearful expression', () => {
    expect(scanKeywords('She trembles in fear as the door creaks open.')).toBe('fearful');
  });

  test('detects amused expression', () => {
    expect(scanKeywords('He chuckles softly to himself.')).toBe('amused');
  });

  test('detects determined expression', () => {
    expect(scanKeywords('Her resolve is steadfast and unyielding.')).toBe('determined');
  });

  test('detects mischievous expression', () => {
    expect(scanKeywords('He smirks with a sly cunning.')).toBe('mischievous');
  });

  test('detects pained expression', () => {
    expect(scanKeywords('She winces in agony as the wound throbs.')).toBe('pained');
  });

  test('detects thoughtful expression', () => {
    expect(scanKeywords('He stands there pondering the strange riddle.')).toBe('thoughtful');
  });

  test('detects sleepy expression', () => {
    expect(scanKeywords('She yawns, feeling drowsy after the long journey.')).toBe('sleepy');
  });

  test('detects blushing expression', () => {
    expect(scanKeywords('He blushes, embarrassed by the compliment.')).toBe('blushing');
  });

  test('detects disgusted expression', () => {
    expect(scanKeywords('She sneers in disgust at the rotting food.')).toBe('disgusted');
  });

  test('detects annoyed expression', () => {
    expect(scanKeywords('He sighs in frustration for the third time.')).toBe('annoyed');
  });

  test('detects relieved expression', () => {
    expect(scanKeywords('She feels relief washing over her.')).toBe('relieved');
  });

  test('detects flirty expression', () => {
    expect(scanKeywords('She winks playfully at the knight.')).toBe('flirty');
  });

  test('detects innocent expression', () => {
    expect(scanKeywords('He speaks innocently in a sweet voice.')).toBe('innocent');
  });

  test('detects confused expression', () => {
    expect(scanKeywords('She looks puzzled by the strange markings.')).toBe('confused');
  });
});
