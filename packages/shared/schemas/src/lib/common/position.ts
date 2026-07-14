// packages/shared/schemas/src/lib/common/position.ts
import Type from 'typebox';
import { GeoPointSchema } from './fields.ts';

/**
 * Two-letter country code ([ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)).
 * Example: DK, (Denmark). Validated as a 2-character string.
 */
export const CountryCodeSchema = Type.String({ minLength: 2, maxLength: 2 });

export type CountryCode = Type.Static<typeof CountryCodeSchema>;
export const PositionFieldSchema = Type.Object({
  geohash: Type.String(),
  geopoint: GeoPointSchema,
});

export type PositionField = Type.Static<typeof PositionFieldSchema>;
export const AddressFieldSchema = Type.Object({
  /**
   * The city name for the location of the requester's public IP address.
   * Non-ASCII characters are encoded according to
   * [RFC3986](https://www.rfc-editor.org/rfc/rfc3986).
   */
  city: Type.Optional(Type.String()),
  country: Type.Optional(Type.String()),
  /**
   * A two-character [ISO
   * 3166-1](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) country code
   * for the country associated with the location of the requester's public IP
   * address.
   */
  countryCode: Type.Optional(Type.Union([CountryCodeSchema, Type.String()])),
  /** ZIP or postal code. */
  postcode: Type.Optional(Type.String()),
  /** State, county, province, or region. */
  region: Type.Optional(Type.String()),
  /**
   * A string of up to three characters containing the region-portion of the
   * [ISO 3166-2](https://en.wikipedia.org/wiki/ISO_3166-2) code for the first
   * level region associated with the requester's public IP address. Some
   * countries have two levels of subdivisions, in which case this is the
   * least specific one. For example, in the United Kingdom this will be a
   * country like "England", not a county like "Devon".
   */
  regionCode: Type.Optional(Type.String()),
});

export type AddressField = Type.Static<typeof AddressFieldSchema>;
