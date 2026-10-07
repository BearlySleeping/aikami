// apps/frontend/client/src/browser_tests/journal_recap_fixture.svelte.ts
import type { PlayerJournalEntry } from '$types';

/** Real-runes capabilities, scoped to one Journal test. */
export class JournalRecapFixture {
  entries = $state<PlayerJournalEntry[]>([]);
  diaryVoice = $state(false);
  setDiaryVoice(value: boolean): void {
    this.diaryVoice = value;
  }
  observe(read: () => string): { prose: string[]; cleanup: () => void } {
    const prose: string[] = [];
    const cleanup = $effect.root(() => {
      $effect(() => {
        prose.push(read());
      });
    });
    return { prose, cleanup };
  }
}
