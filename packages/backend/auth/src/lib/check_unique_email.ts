import { getUserByEmail } from '@aikami/backend/database/user.ts';
import type { AuthMessagePayload, AuthMessageResponse } from '@aikami/types';

/**
 * Check if email exists
 *
 * @param options the user email
 */
export const checkUniqueEmail = async (
  options: AuthMessagePayload<'checkUniqueEmail'>,
): Promise<AuthMessageResponse<'checkUniqueEmail'>> => {
  const { email } = options;
  const user = await getUserByEmail(email);
  return !user;
};
