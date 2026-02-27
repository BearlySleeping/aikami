import type { UserData } from '@aikami/types';

import { getUserDocumentPath } from '$paths';

import type { MockAuth } from '../types/index.ts';

type MockUserData = Omit<UserData, 'agreedAt' | 'createdAt'>;

export const activeMemberAuth = {
  token: {
    email: 'active@consumer.consumer',
    userRole: 'member',
  },
  uid: 'activeMember',
} as const satisfies Readonly<MockAuth>;

export const inactiveMemberAuth = {
  token: {
    email: 'inactive@consumer.consumer',
  },
  uid: 'inactiveMember',
} as const satisfies Readonly<MockAuth>;

export const newAuth = {
  token: {
    email: 'new@new.new',
  },
  uid: 'new',
} as const satisfies Readonly<MockAuth>;

export const adminAuth = {
  token: {
    admin: true,
    email: 'active@admin.admin',
  },
  uid: 'admin',
} as const satisfies Readonly<MockAuth>;

const baseUser = {
  countryCode: 'NO',
  displayName: 'Test User',
  email: 'active@admin.admin',
  firstName: 'Test',
  id: 'admin',
  lastName: 'User',
  localeCode: 'en',
  signInProviders: ['email'],
  userRole: 'superAdmin',
} satisfies MockUserData;

export const adminData = {
  ...baseUser,
  email: 'active@admin.admin',
  userRole: 'superAdmin',
} satisfies MockUserData;

export const inactiveMemberData = {
  ...baseUser,
  email: 'inactive@consumer.consumer',
  userRole: 'member',
} satisfies MockUserData;

export const activeMemberData = {
  ...baseUser,
  email: 'active@consumer.consumer',
  userRole: 'member',
} satisfies MockUserData;

export const mockUserData = {
  [getUserDocumentPath(activeMemberData.id)]: activeMemberData,
  [getUserDocumentPath(adminData.id)]: adminData,
  [getUserDocumentPath(inactiveMemberData.id)]: inactiveMemberData,
  [getUserDocumentPath(inactiveMemberData.id)]: inactiveMemberData,
} as const;
