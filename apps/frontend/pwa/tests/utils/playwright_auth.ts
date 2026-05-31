import type { Page } from '@playwright/test';
import { TEST_USER_EMAIL, TEST_USER_ID, TEST_USER_NAME } from './auth.ts';

export const TEST_AUTH_HEADER = 'x-test-mode';
export const TEST_USER_ID_HEADER = 'x-test-user-id';
export const TEST_USER_EMAIL_HEADER = 'x-test-user-email';
export const TEST_USER_NAME_HEADER = 'x-test-user-name';

export type TestUserOptions = {
  userId?: string;
  email?: string;
  name?: string;
};

export async function authenticatePage(page: Page, options: TestUserOptions = {}): Promise<void> {
  const userId = options.userId || TEST_USER_ID;
  const email = options.email || TEST_USER_EMAIL;
  const name = options.name || TEST_USER_NAME;

  await page.setExtraHTTPHeaders({
    [TEST_AUTH_HEADER]: 'true',
    [TEST_USER_ID_HEADER]: userId,
    [TEST_USER_EMAIL_HEADER]: email,
    [TEST_USER_NAME_HEADER]: name,
  });
}

export async function authenticateAndGo(
  page: Page,
  url: string,
  options: TestUserOptions = {},
): Promise<void> {
  await authenticatePage(page, options);
  await page.goto(url);
}
