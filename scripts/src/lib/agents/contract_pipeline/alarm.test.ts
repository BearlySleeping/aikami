// scripts/src/lib/agents/contract_pipeline/alarm.test.ts
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ALARM_FILE, playerFor, resolveAlarmFile } from './alarm.ts';

const which = (bin: string): string | null => (bin === 'aplay' ? '/usr/bin/aplay' : null);

// A real file that exists, standing in for the shipped alarm WAV.
const SAMPLE = join(process.cwd(), 'src/lib/agents/contract_pipeline/alarm.ts');

const fileFor = (platform: NodeJS.Platform, wh = which): string[] | null =>
  playerFor(platform, wh, SAMPLE);

describe('playerFor', () => {
  it('returns null when the sound file is missing', () => {
    expect(playerFor('linux', which, '/nonexistent/alarm.wav')).toBe(null);
  });

  it('skips unavailable platforms gracefully', () => {
    expect(fileFor('linux', () => null)).toBe(null);
  });

  it('maps macOS to afplay', () => {
    const argv = fileFor('darwin');
    expect(argv?.[0]).toBe('afplay');
    expect(argv?.[1]).toBe(SAMPLE);
  });

  it('maps Windows to PowerShell SoundPlayer (WAV only)', () => {
    const argv = fileFor('win32');
    expect(argv?.[0]).toBe('powershell');
    expect(argv?.join(' ')).toContain("Media.SoundPlayer '");
    expect(argv?.join(' ')).toContain('PlaySync');
  });

  it('picks the first available Linux player', () => {
    const argv = fileFor('linux', (bin) => (bin === 'paplay' ? '/usr/bin/paplay' : null));
    expect(argv?.[0]).toBe('paplay');
  });

  it('falls back to aplay and passes the quiet flag', () => {
    const argv = fileFor('linux');
    expect(argv?.[0]).toBe('aplay');
    expect(argv).toEqual(['aplay', '-q', SAMPLE]);
  });
});

describe('alarm asset', () => {
  it('ships a playable WAV at .pi/sounds/alarm.wav', () => {
    expect(existsSync(resolveAlarmFile())).toBe(true);
  });

  it('keeps ALARM_FILE relative to the repo root', () => {
    expect(ALARM_FILE).toBe('.pi/sounds/alarm.wav');
  });
});
