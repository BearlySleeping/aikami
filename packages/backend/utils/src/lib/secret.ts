import crypto from 'node:crypto';

/**
 * Get the prefix for a given environment flavor.
 *
 * @param flavor - The environment flavor ('staging', 'production').
 * @returns The prefix corresponding to the flavor.
 */
const getPrefix = (flavor: string): string => {
  switch (flavor) {
    case 'staging':
      return 'sk_stg';
    case 'production':
      return 'sk_prod';
    default:
      return `sk_${flavor}`;
  }
};

/**
 * Generate a secure secret string for SDK access.
 *
 * @param flavor - The environment flavor ('staging', 'production').
 * @returns A secure secret string prefixed based on the environment flavor.
 */
export const generateSecret = (flavor: string): string => {
  const prefix = getPrefix(flavor);

  // Generate a secure random string
  const randomBytes = crypto.randomBytes(32);
  const secret = randomBytes.toString('hex');

  return `${prefix}_${secret}`;
};
