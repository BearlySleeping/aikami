import type { UserSessionData } from '@aikami/types';

export const TEST_USER_ID = 'test-user-123';
export const TEST_USER_EMAIL = 'test@example.com';
export const TEST_USER_NAME = 'Test User';

export function createMockUserSession(overrides?: Partial<UserSessionData>): UserSessionData {
  const baseSession: UserSessionData = {
    id: TEST_USER_ID,
    displayName: TEST_USER_NAME,
    email: TEST_USER_EMAIL,
    emailVerified: true,
    photoURL: undefined,
    disabled: false,
    customClaims: {},
    userRole: 'member',
    status: 'active',
    preferredLocale: 'en',
    currentSignInProvider: 'email',
  };

  return { ...baseSession, ...overrides };
}

export function createTestUserSession(overrides?: Partial<UserSessionData>): UserSessionData {
  return createMockUserSession(overrides);
}
