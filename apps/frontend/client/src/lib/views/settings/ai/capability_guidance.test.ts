// apps/frontend/client/src/lib/views/settings/ai/capability_guidance.test.ts
import { describe, expect, test } from 'bun:test';
import { buildCapabilityGuidance } from './capability_guidance';

describe('capability guidance', () => {
  test('explains unconfigured text capability and offline play', () => {
    const guidance = buildCapabilityGuidance({ capability: 'text', status: 'not_configured' });

    expect(guidance.title).toBe('Story & Dialogue');
    expect(guidance.description).toContain('dialogue');
    expect(guidance.availabilityLabel).toBe('Unavailable · not configured');
    expect(guidance.setupActionLabel).toBe('Set up a text connection');
    expect(guidance.playableWithout).toContain('remain playable');
  });

  test('does not imply configured text is available before testing', () => {
    const guidance = buildCapabilityGuidance({ capability: 'text', status: 'not_tested' });

    expect(guidance.availabilityLabel).toBe('Configured · availability not tested');
  });

  test('distinguishes reachable and failed connections', () => {
    expect(
      buildCapabilityGuidance({ capability: 'image', status: 'reachable' }).availabilityLabel,
    ).toBe('Available now');
    expect(
      buildCapabilityGuidance({ capability: 'voice', status: 'unreachable' }).availabilityLabel,
    ).toBe('Unavailable · connection test failed');
  });
});
