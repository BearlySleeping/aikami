// apps/e2e/tests/game/journal_recap_persistence.spec.ts
import { test } from '@playwright/test';
import { JournalRecapPage } from '$pom';

// No provider fixtures or database mocks: /game boots the real local adapter.
// Only the opening and a combat chip are authored deterministically via the
// existing non-production seam. All user actions use the production UI.
test('production dialogue closes into Recaps, not Notes, and survives game reload with diary voice', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const journal = new JournalRecapPage(page);
  await journal.game.goto({ bypassTextAi: true });
  await journal.shell.seedManagementContent('empty');

  // Opening and closing an untouched greeting must not create a record.
  await journal.openDialogue();
  await journal.dialogue.endChat();
  await journal.openRecaps();
  await journal.expectNoRecaps();
  await journal.closeJournal();

  // The production chip handler appends its actual action notice and closes
  // through the game UI lifecycle. No direct call to the recorder is made.
  await journal.openDialogue();
  await journal.attackAndFinish();
  await journal.openRecaps();
  await journal.expectActionRecap();
  await journal.expectNotesSeparate();
  await journal.enableDiary();
  await journal.closeJournal();

  // Save through the production Pause UI, then reload the page/real database.
  await journal.game.saveGame();
  await journal.game.reload();
  await journal.openRecaps();
  await journal.expectActionRecap();
  await journal.expectNotesSeparate();
  await journal.expectDiary();
});
