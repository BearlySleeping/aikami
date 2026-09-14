// apps/frontend/client/src/lib/services/audio/audio_candidate_review.test.ts

import { describe, expect, mock, test } from 'bun:test';
import { AudioCandidateReview } from './audio_candidate_review.svelte.ts';

describe('AudioCandidateReview', () => {
  test('clears candidate state before a replacement fetch begins', async () => {
    const realFetch = globalThis.fetch;
    let resolveFetch: ((response: Response) => void) | undefined;
    globalThis.fetch = mock(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    try {
      const review = AudioCandidateReview.create({ className: 'AudioCandidateReview' });
      review.loaded = true;
      review.peaks = [0.5];
      review.durationSeconds = 4;
      review.sampleRate = 48_000;
      review.loopStartSeconds = 1;
      review.loopEndSeconds = 3;

      const loading = review.load({ url: 'blob:replacement' });

      expect(review.loaded).toBe(false);
      expect(review.peaks).toEqual([]);
      expect(review.durationSeconds).toBe(0);
      expect(review.sampleRate).toBe(0);
      expect(review.loopStartSeconds).toBeUndefined();
      resolveFetch?.(new Response('', { status: 500 }));
      await loading;
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('clears then restores repeated announcements and ignores an older restore', () => {
    const scheduled: Array<{ restore: () => void; cancelled: boolean }> = [];
    const review = AudioCandidateReview.create({
      className: 'AudioCandidateReview',
      scheduleAnnouncement: (restore) => {
        const entry = { restore, cancelled: false };
        scheduled.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
    });

    review.reset();
    expect(review.announcedStatusLabel).toBe('');
    scheduled[0]?.restore();
    expect(review.announcedStatusLabel).toBe('No audio candidate loaded.');
    review.reset();
    expect(review.announcedStatusLabel).toBe('');
    scheduled[1]?.restore();
    expect(review.announcedStatusLabel).toBe('No audio candidate loaded.');

    review.loaded = true;
    review.durationSeconds = 2;
    review.toggleMute();
    const older = scheduled[2];
    review.toggleMute();
    const newer = scheduled[3];
    expect(older?.cancelled).toBe(true);
    newer?.restore();
    expect(review.announcedStatusLabel).toContain('unmuted');
    older?.restore();
    expect(review.announcedStatusLabel).toContain('unmuted');
  });

  test('exposes render-ready waveform geometry', () => {
    const review = AudioCandidateReview.create({ className: 'AudioCandidateReview' });
    review.peaks = [0.25, 0.5];
    review.durationSeconds = 4;
    review.loopStartSeconds = 1;
    review.loopEndSeconds = 3;

    expect(review.hasWaveform).toBe(true);
    expect(review.waveformPath).toContain('M 0.00');
    expect(review.loopRegionX).toBe(120);
    expect(review.loopRegionWidth).toBe(240);
  });
});
