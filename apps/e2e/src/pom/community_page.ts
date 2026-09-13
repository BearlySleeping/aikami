// apps/e2e/src/pom/community_page.ts

import type { Page } from '@playwright/test';

/** Community asset browse/import page interactions. */
export class CommunityPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get heading() {
    return this.page.getByRole('heading', { name: 'Community assets' });
  }

  get firstCommunityRow() {
    return this.page.getByTestId('community-row').first();
  }

  get importMessage() {
    return this.page.getByTestId('community-message');
  }

  async goto(): Promise<void> {
    await this.page.goto('/studio/community');
  }

  async importFirstAsset(): Promise<void> {
    await this.firstCommunityRow.getByRole('button', { name: 'Import' }).click();
  }
}
