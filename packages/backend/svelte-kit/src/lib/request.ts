import type { CountryCode } from '@aikami/types'

import { countryCodes } from '@aikami/constants'
/**
 * ;^)
 *
 * @param headers all the incoming headers
 * @param key the key of the value you want to get
 * @returns the value of the key or undefined
 */
export const getHead = (headers: Headers, key: string): string | undefined => {
  const head = headers.get(key)
  return head ?? undefined
}

export const getCountryCodeFromRequest = (
  request: Request,
): CountryCode | undefined => {
  const headers = request.headers

  const countryCode = getHead(headers, 'x-vercel-ip-country')

  if (countryCode && countryCodes.includes(countryCode)) {
    return countryCode as CountryCode
  }
  return
}
