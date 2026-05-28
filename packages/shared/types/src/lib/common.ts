import type { CountryToCode } from '@aikami/constants';
import type { GeoPoint } from './api/firestore.ts';
import type { AppError } from './error.ts'; // Adjust import based on your structure

export type BaseForm = Record<string, unknown>;

export type AppResult<T = void, E = AppError> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Example: DK, (Denmark) Two-letter country code ([ISO 3166-1
 * alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)).
 */
export type CountryCode = keyof typeof CountryToCode;

/**
 * The zod parse level.
 *
 * - `off` - No parsing is done.
 * - `safe` - Only safe parsing is done. This won't throw error, but will still
 *   log it to sentry.
 * - `on` - All parsing is done.
 */
export type ParseLevel = 'off' | 'safe' | 'on';
export type CommonError = {
  code?: string;
  message?: string;
};

export type PositionFieldData = {
  geohash: string;
  geopoint: GeoPoint;
};
export type AddressFieldData = {
  country?: string;
  /** State, county, province, or region. */
  region?: string;
  /**
   * The city name for the location of the requester's public IP address.
   * Non-ASCII characters are encoded according to
   * [RFC3986](https://www.rfc-editor.org/rfc/rfc3986).
   */
  city?: string;
  /** ZIP or postal code. */
  postcode?: string;
  /**
   * A two-character [ISO
   * 3166-1](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) country code
   * for the country associated with the location of the requester's public IP
   * address.
   */
  countryCode?: CountryCode | string;
  /**
   * A string of up to three characters containing the region-portion of the
   * [ISO 3166-2](https://en.wikipedia.org/wiki/ISO_3166-2) code for the first
   * level region associated with the requester's public IP address. Some
   * countries have two levels of subdivisions, in which case this is the
   * least specific one. For example, in the United Kingdom this will be a
   * country like "England", not a county like "Devon".
   */
  regionCode?: string;
};

/**
 * Common interface to display a value with a user friendly text instead of the
 * "rough" value.
 */
export type TextValue<
  Text extends string = string,
  Value extends string | number | boolean | undefined = string,
> = {
  text: Text;
  value: Value;
};

export type GeolocationData = {
  address?: AddressFieldData;
  position?: {
    latitude: number;
    longitude: number;
  };
  ip?: string;
};

export type LessThan<
  TNumber extends number,
  TArray extends unknown[] = [],
> = TNumber extends TArray['length']
  ? TArray[number]
  : LessThan<TNumber, [...TArray, TArray['length']]>;

export type NumericRange<TStart extends number, TEnd extends number> = Exclude<
  TEnd | LessThan<TEnd>,
  LessThan<TStart>
>;
