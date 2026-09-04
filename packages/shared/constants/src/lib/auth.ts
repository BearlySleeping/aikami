/**
 * The session store cookie name.
 *
 * 🔴 Must be literally `__session`: Firebase Hosting strips ALL cookies
 * (except `__session`) from requests it forwards to Cloud Run / Functions
 * rewrites — any other name silently breaks server sessions on page GETs.
 * See https://firebase.google.com/docs/hosting/manage-cache#using_cookies
 */
export const AUTH_COOKIE_NAME = '__session';

export const userRoles = ['member', 'superAdmin'] as const;

export const userStatuses = [
  'active',
  'trialing',
  'unpaid',
  'canceled',
  'inactive',
  'unconfirmed',
] as const;

export const signInProviderNames = ['google', 'github'] as const;

/**
 * The tombstone owner account id. Published packs are transferred here on
 * deletion rather than removed — see C-464 AC-4.
 */
export const DELETED_OWNER_ACCOUNT_ID = 'deleted-user';
