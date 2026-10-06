// apps/e2e/src/pom/journal_recap_page.ts
import { expect, type Page } from '@playwright/test';
import { DialoguePage } from './dialogue_page.ts';
import { GamePage } from './game_page.ts';
import { PlayShellPage } from './play_shell_page.ts';

/** Full-game dialogue recording and real device-storage reload acceptance. */
export class JournalRecapPage {
  readonly game: GamePage;
  readonly shell: PlayShellPage;
  readonly dialogue: DialoguePage;
  constructor(readonly page: Page) {
    this.game = new GamePage(page);
    this.shell = new PlayShellPage(page);
    this.dialogue = new DialoguePage(page);
  }

  async openDialogue(): Promise<void> {
    await this.page.evaluate(() => {
      const seam: unknown = Reflect.get(window, '__AIKAMI_TEST__');
      if (!seam || typeof seam !== 'object') {
        throw new Error('Game test seam absent');
      }
      const open: unknown = Reflect.get(seam, 'openJournalRecapDialogue');
      if (typeof open !== 'function') {
        throw new Error('Journal dialogue fixture absent');
      }
      Reflect.apply(open, seam, []);
    });
    await this.dialogue.expectDialogueVisible();
    await expect(this.dialogue.overlay).toContainText('There is a tavern near the road.');
  }

  async openRecaps(): Promise<void> {
    await this.shell.openManagementHost();
    await this.shell.openManagementSection('journal');
    await this.shell.journalTabs.getByRole('tab', { name: 'Recaps', exact: true }).click();
  }

  async closeJournal(): Promise<void> {
    await this.shell.managementReturn.click();
    await expect(this.shell.managementHost).not.toBeVisible();
  }

  async expectNoRecaps(): Promise<void> {
    await expect(this.page.getByTestId('conversation-recap')).toHaveCount(0);
    await expect(this.page.getByTestId('journal-recap-empty')).toBeVisible();
  }

  async attackAndFinish(): Promise<void> {
    await this.game.clickChip('Attack');
    await expect(this.dialogue.overlay).toContainText('reaches for a weapon — combat begins');
    await expect(this.dialogue.overlay).not.toBeVisible({ timeout: 15_000 });
    await this.page.evaluate(() => {
      const seam: unknown = Reflect.get(window, '__AIKAMI_TEST__');
      if (!seam || typeof seam !== 'object') {
        throw new Error('Game seam absent');
      }
      const finish: unknown = Reflect.get(seam, 'scheduleCombatEndedCleanup');
      if (typeof finish !== 'function') {
        throw new Error('Combat cleanup absent');
      }
      Reflect.apply(finish, seam, []);
    });
    await expect(this.shell.managementMenuEntry).toBeVisible({ timeout: 15_000 });
  }

  async expectActionRecap(): Promise<void> {
    const recap = this.page.getByTestId('conversation-recap');
    await expect(recap).toHaveCount(1);
    await expect(recap).toContainText('Rollo the Grasper');
    await expect(recap).toContainText('reaches for a weapon — combat begins');
    await expect(recap).toContainText('Local transcript record');
  }

  async expectNotesSeparate(): Promise<void> {
    await this.shell.journalTabs.getByRole('tab', { name: /Notes/ }).click();
    await expect(this.shell.journalNotesEmpty).toBeVisible();
    await expect(this.shell.journalNoteList).not.toContainText('Conversation with Rollo');
    await this.shell.journalTabs.getByRole('tab', { name: 'Recaps', exact: true }).click();
  }

  async enableDiary(): Promise<void> {
    await this.page.getByLabel('Personal diary voice').check();
    await this.expectDiary();
  }

  async expectDiary(): Promise<void> {
    await expect(this.page.getByLabel('Personal diary voice')).toBeChecked();
    const recap = this.page.getByTestId('conversation-recap');
    await expect(recap).toContainText('I talked with Rollo the Grasper.');
    await recap.getByText('Objective record', { exact: true }).click();
    await expect(recap.locator('details')).toContainText('Talked with Rollo the Grasper.');
  }
}
