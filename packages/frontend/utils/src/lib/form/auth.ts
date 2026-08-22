import type { RegisterData, SignInProvider } from '@aikami/types';

/**
 * Builds a RegisterData payload from a Better Auth session user.
 *
 * @param user The Better Auth user (id, email, name).
 * @param provider The sign-in provider used (defaults to 'email').
 */
export const getRegisterDataFromUser = (options: {
  id: string;
  email?: string | null;
  name?: string | null;
  provider?: SignInProvider;
}): RegisterData => {
  const { id, email, name, provider = 'email' } = options;

  if (!email) {
    throw new Error('Email is required');
  }

  const displayName = name ?? undefined;
  let firstName = '';
  let lastName = '';
  if (displayName) {
    const names = displayName.split(' ');
    firstName = names.shift() ?? '';
    if (names.length > 0) {
      lastName = names.join(' ');
    }
  }

  return {
    email,
    signInProvider: provider,
    uid: id,
    userMetadata: {
      firstName,
      lastName,
    },
  };
};
