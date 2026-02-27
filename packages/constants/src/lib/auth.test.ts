import { describe, expect, test } from 'bun:test';
import { firebaseSignInProviderNames, userRoles, userStatuses } from './auth.ts';

describe('userRoles', () => {
  test('should be a tuple of valid user roles', () => {
    expect(userRoles).toEqual(['member', 'superAdmin']);
  });

  test('should contain member role', () => {
    expect(userRoles).toContain('member');
  });

  test('should contain superAdmin role', () => {
    expect(userRoles).toContain('superAdmin');
  });

  test('should be readonly tuple', () => {
    const roles: readonly ['member', 'superAdmin'] = userRoles;
    expect(roles).toEqual(['member', 'superAdmin']);
  });
});

describe('userStatuses', () => {
  test('should be a tuple of valid user statuses', () => {
    expect(userStatuses).toContain('active');
    expect(userStatuses).toContain('trialing');
    expect(userStatuses).toContain('unpaid');
    expect(userStatuses).toContain('canceled');
    expect(userStatuses).toContain('inactive');
    expect(userStatuses).toContain('unconfirmed');
  });

  test('should have correct length', () => {
    expect(userStatuses.length).toBe(6);
  });
});

describe('firebaseSignInProviderNames', () => {
  test('should be a tuple of valid provider names', () => {
    expect(firebaseSignInProviderNames).toEqual(['google', 'github']);
  });

  test('should contain google', () => {
    expect(firebaseSignInProviderNames).toContain('google');
  });

  test('should contain github', () => {
    expect(firebaseSignInProviderNames).toContain('github');
  });
});
