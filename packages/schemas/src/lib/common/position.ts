import { z } from 'zod'
import { CountryToCode } from '@aikami/constants'
import { GeoPointSchema } from '../fields.ts'

type CountryCode = keyof typeof CountryToCode
// z.enum expects a non-empty array so to work around that
// we pull the first value out explicitly
const CountryCodes: [CountryCode, ...CountryCode[]] = Object.keys(
  CountryToCode,
) as [CountryCode, ...CountryCode[]]

/**
 * Example: DK, (Denmark) Two-letter country code ([ISO 3166-1
 * alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)).
 */
export const CountryCodeSchema = z.enum(CountryCodes)

export const PositionFieldSchema = z.object({
  geohash: z.string(),
  geopoint: GeoPointSchema,
})

export const AddressFieldSchema = z.object({
  /**
   * The city name for the location of the requester's public IP address.
   * Non-ASCII characters are encoded according to
   * [RFC3986](https://www.rfc-editor.org/rfc/rfc3986).
   */
  city: z.string().optional(),
  country: z.string().optional(),
  /**
   * A two-character [ISO
   * 3166-1](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) country code
   * for the country associated with the location of the requester's public IP
   * address.
   */
  countryCode: z.union([CountryCodeSchema, z.string()]).optional(),
  /** ZIP or postal code. */
  postcode: z.string().optional(),
  /** State, county, province, or region. */
  region: z.string().optional(),
  /**
   * A string of up to three characters containing the region-portion of the
   * [ISO 3166-2](https://en.wikipedia.org/wiki/ISO_3166-2) code for the first
   * level region associated with the requester's public IP address. Some
   * countries have two levels of subdivisions, in which case this is the
   * least specific one. For example, in the United Kingdom this will be a
   * country like "England", not a county like "Devon".
   */
  regionCode: z.string().optional(),
})
