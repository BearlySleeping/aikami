import type { SignInProvider } from '@aikami/types'

export const toSignInProvider = (signInProviderId: string): SignInProvider => {
  switch (signInProviderId) {
    case 'google.com':
    case 'google':
      return 'google'
    case 'github.com':
    case 'github':
      return 'github'
    default:
      return 'email'
  }
}
