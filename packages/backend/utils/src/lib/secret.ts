import crypto from 'node:crypto'

/**
 * Get the prefix for a given environment flavor.
 *
 * @param flavor - The environment flavor ('development', 'staging',
 *   'production').
 * @returns The prefix corresponding to the flavor.
 */
const getPrefix = (flavor: string): string => {
  switch (flavor) {
    case 'development':
      return 'sk_dev'
    case 'staging':
      return 'sk_stage'
    case 'production':
      return 'sk_prod'
    default:
      return `sk_${flavor}`
  }
}

/**
 * Generate a secure secret string for SDK access.
 *
 * @param flavor - The environment flavor ('development', 'staging',
 *   'production').
 * @returns A secure secret string prefixed based on the environment flavor.
 */
export const generateSecret = (flavor: string): string => {
  const prefix = getPrefix(flavor)

  // Generate a secure random string
  const randomBytes = crypto.randomBytes(32)
  const secret = randomBytes.toString('hex')

  return `${prefix}_${secret}`
}
