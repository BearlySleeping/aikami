export const AUTH_COOKIE_NAME = '__aikami_session';

export const userRoles = ['member', 'superAdmin'] as const;

export const userStatuses = [
  'active',
  'trialing',
  'unpaid',
  'canceled',
  'inactive',
  'unconfirmed',
] as const;

export const firebaseSignInProviderNames = ['google', 'github'] as const;
