# Playwright Tests

This document provides an overview of the Playwright tests for the PWA.

## Overview

Playwright is a Node.js library that provides a high-level API for controlling a browser. We use Playwright to write end-to-end (E2E) tests for the PWA. These tests simulate user interactions and verify that the application is working correctly.

## Installation

To run the Playwright tests, you first need to install the Playwright browsers:

```bash
npx playwright install
```

## Running the Tests

To run the Playwright tests, use the following command:

```bash
npx playwright test
```

This command will run all the Playwright tests in the project.

## Test Structure

The Playwright tests are located in the `apps/frontend/pwa/tests` directory. The tests are organized by feature, with each feature having its own test file.

For example, the tests for the authentication feature are located in the `apps/frontend/pwa/tests/auth.spec.ts` file.

### Test File

Each test file should have the following structure:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
    test.beforeEach(async ({ page }) => {
        // Go to the page that you want to test.
        await page.goto('/');
    });

    test('Test case name', async ({ page }) => {
        // Write your test case here.
    });
});
```

### Locators

We use locators to find elements on the page. We prefer to use user-facing locators, such as `getByRole`, `getByText`, and `getByLabel`.

For more information on locators, please refer to the [Playwright documentation](https://playwright.dev/docs/locators).

### Assertions

We use assertions to verify that the application is working correctly. We use the `expect` function from Playwright to write our assertions.

For more information on assertions, please refer to the [Playwright documentation](https://playwright.dev/docs/assertions).

## Test Cases

The following is a list of the test cases that we should write for the PWA:

### Authentication

-   A user can sign up with a new account.
-   A user can sign in with an existing account.
-   A user can sign out.
-   A user can reset their password.

### Character Selection

-   A user can see a list of characters.
-   A user can select a character to chat with.

### Chat

-   A user can send a message.
-   A user can see the chat history.

### Image Generation

-   A user can generate an image of a character.
-   A user can see the generated images.

### User Profile

-   A user can see their profile.
--   A user can see their chat history.
-   A user can see their generated images.

## Conclusion

By writing these Playwright tests, we can ensure that the PWA is working correctly and that it is free of bugs. If you have any questions or suggestions, please feel free to open an issue or a pull request.
