import { countryCodes } from '@aikami/constants';
import type { CountryCode } from '@aikami/types';
/**
 * ;^)
 *
 * @param headers all the incoming headers
 * @param key the key of the value you want to get
 * @returns the value of the key or undefined
 */
export const getHead = (headers: Headers, key: string): string | undefined => {
  const head = headers.get(key);
  return head ?? undefined;
};

export const getCountryCodeFromRequest = (request: Request): CountryCode | undefined => {
  const headers = request.headers;

  // Google Cloud HTTP(S) Load Balancer sets x-client-geo-location as a
  // JSON object, e.g. {"country":"US",...}. The LB overwrites any
  // client-supplied copy, so this header is trusted.
  const geoHeader = getHead(headers, 'x-client-geo-location');
  if (!geoHeader) {
    return;
  }

  try {
    const geo = JSON.parse(geoHeader) as { country?: string };
    const countryCode = geo.country;
    if (countryCode && countryCodes.includes(countryCode)) {
      return countryCode as CountryCode;
    }
  } catch {
    // Malformed header — ignore.
  }
  return;
};
