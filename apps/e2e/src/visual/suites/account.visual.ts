// apps/e2e/src/visual/suites/account.visual.ts
//
// C-464 AC-1/AC-7: Visual tests for the Account settings section.
// Signed-out state and delete account confirmation dialog.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const AccountSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual score' }),
  hasSignInButtons: Type.Boolean({
    description: 'Whether Google and email sign-in buttons are visible',
  }),
  hasOfflineMessage: Type.Boolean({
    description: 'Whether the offline/device-local message is shown',
  }),
  hasNoDeleteControls: Type.Boolean({
    description: 'Whether no sync or delete controls are visible when signed out',
  }),
  issues: Type.Array(Type.String(), { description: 'Visual issues found' }),
});

export default defineConfig({
  id: 'account',
  route: '/settings?group=account',
  waitCondition: 'pixi_loaded',
  requiresAuth: false,
  cases: [
    {
      name: 'Signed-out state',
      searchParams: {},
      prompt: `Evaluate the Account settings page. The page should show:
1. A message stating the game works without an account
2. "Sign in with Google" button
3. "Sign in with Email" button
4. No sync controls, no delete buttons
5. Clean layout with proper spacing`,
      schema: AccountSchema,
      setupHook: async () => {
        // No auth needed for signed-out state
      },
    },
  ],
});
