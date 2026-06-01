/** biome-ignore-all lint/style/useNamingConvention: ISO country code keys */
import type { CountryCode } from '@aikami/types';

const COUNTRY_CODE_TAX_ID_TYPE_MAP = {
  AE: 'ae_trn',
  AU: 'au_abn',
  BG: 'bg_uic',
  BR: 'br_cnpj', // or 'br_cpf'
  CA: undefined, // Depending on province/territory, it could be one of the following: 'ca_bn', 'ca_gst_hst', 'ca_pst_bc', 'ca_pst_mb', 'ca_pst_sk', 'ca_qst'
  CH: 'ch_vat',
  CL: 'cl_tin',
  EG: 'eg_tin',
  ES: 'es_cif',
  GB: 'gb_vat',
  GE: 'ge_vat',
  HK: 'hk_br',
  HU: 'hu_tin',
  ID: 'id_npwp',
  IL: 'il_vat',
  IN: 'in_gst',
  IS: 'is_vat',
  JP: undefined, // Depending on the organization type, it could be one of the following: 'jp_cn', 'jp_rn', 'jp_trn'
  KE: 'ke_pin',
  KR: 'kr_brn',
  LI: 'li_uid',
  MX: 'mx_rfc',
  MY: undefined, // Depending on the tax type, it could be one of the following: 'my_frp', 'my_itn', 'my_sst'
  NO: 'no_vat',
  NZ: 'nz_gst',
  PH: 'ph_tin',
  RU: undefined, // Depending on the organization type, it could be one of the following: 'ru_inn', 'ru_kpp
  SA: 'sa_vat',
  SG: undefined, // Depending on the business structure, it could be one of the following: 'sg_gst', 'sg_uen'
  SI: 'si_tin',
  TH: 'th_vat',
  TR: 'tr_tin',
  TW: 'tw_vat',
  UA: 'ua_vat',
  US: 'us_ein',
  ZA: 'za_vat',
} as const satisfies Partial<Record<CountryCode, TaxIdType | undefined>>;

type TaxIdType =
  | 'ae_trn'
  | 'au_abn'
  | 'au_arn'
  | 'bg_uic'
  | 'br_cnpj'
  | 'br_cpf'
  | 'ca_bn'
  | 'ca_gst_hst'
  | 'ca_pst_bc'
  | 'ca_pst_mb'
  | 'ca_pst_sk'
  | 'ca_qst'
  | 'ch_vat'
  | 'cl_tin'
  | 'eg_tin'
  | 'es_cif'
  | 'eu_oss_vat'
  | 'eu_vat'
  | 'gb_vat'
  | 'ge_vat'
  | 'hk_br'
  | 'hu_tin'
  | 'id_npwp'
  | 'il_vat'
  | 'in_gst'
  | 'is_vat'
  | 'jp_cn'
  | 'jp_rn'
  | 'jp_trn'
  | 'ke_pin'
  | 'kr_brn'
  | 'li_uid'
  | 'mx_rfc'
  | 'my_frp'
  | 'my_itn'
  | 'my_sst'
  | 'no_vat'
  | 'nz_gst'
  | 'ph_tin'
  | 'ru_inn'
  | 'ru_kpp'
  | 'sa_vat'
  | 'sg_gst'
  | 'sg_uen'
  | 'si_tin'
  | 'th_vat'
  | 'tr_tin'
  | 'tw_vat'
  | 'ua_vat'
  | 'us_ein'
  | 'za_vat';

const TAX_ID_TYPE_REGEX_MAP = {
  ae_trn: /^[1-9]{1}[0-9]{14}$/,
  au_abn: /^(\d{11})$/,
  au_arn: /^(\d{9})$/,
  bg_uic: /^(\d{9,10})$/,
  br_cnpj: /^(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/,
  br_cpf: /^(\d{3}\.\d{3}\.\d{3}-\d{2})$/,
  ca_bn: /^([0-9a-zA-Z]{15})$/,
  ca_gst_hst: /^(\d{9}RT\d{4})$/,
  ca_pst_bc: /^(\d{9})$/,
  ca_pst_mb: /^(\d{9})$/,
  ca_pst_sk: /^(\d{9})$/,
  ca_qst: /^(\d{9}TQ\d{6})$/,
  ch_vat: /^(CHE)(\d{9})(MWST)?$/,
  cl_tin: /^(\d{8})-([\dkK])$/,
  eg_tin: /^(\d{9,10})$/,
  es_cif: /^([a-zA-Z]\d{7}[a-zA-Z0-9])$/,
  eu_oss_vat: /^([A-Z]{2}\d{9,12})$/,
  eu_vat: /^([A-Z]{2}[0-9A-Z]{2,12})$/,
  gb_vat: /^(GB)?(\d{9}(\d{3})?|[A-Z]{2}\d{3})$/,
  ge_vat: /^(\d{9})$/,
  hk_br: /^(\d{8})$/,
  hu_tin: /^(\d{8})$/,
  id_npwp: /^(\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3})$/,
  il_vat: /^(\d{8})$/,
  in_gst: /^\d{2}[a-zA-Z]{5}\d{4}[a-zA-Z]{1}\d[Z]{1}[a-zA-Z\d]{1}$/,
  is_vat: /^(IS)(\d{3})(\d{2})(\d{1})$/,
  jp_cn: /^(\d{3})(\d{2})(\d{4})$/,
  jp_rn: /^(\d{6})(\d{2})(\d{1})(\d{1})?$/,
  jp_trn: /^(\d{10})$/,
  ke_pin: /^(\d{9}[A-Z]{1})$/,
  kr_brn: /^(\d{3}-\d{2}-\d{5})$/,
  li_uid: /^(LI)?(FL)?(2\d{3})(\d{4})(\d{1})$/,
  mx_rfc: /^([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})$/,
  my_frp: /^(\d{6}[A-Z]{2})$/,
  my_itn: /^(\d{10})$/,
  my_sst: /^(\d{10})$/,
  no_vat: /^(\d{9})$/,
  nz_gst: /^(\d{9})$/,
  ph_tin: /^(\d{3}-\d{7}-\d{1})$/,
  ru_inn: /^(\d{10}|\d{12})$/,
  ru_kpp: /^(\d{9})$/,
  sa_vat: /^(\d{2}[0-9]{8})$/,
  sg_gst: /^((\d{9}|[0-9]{12}))[A-Z]{1}$/,
  sg_uen: /^(\d{8}[A-Z]{1})$/,
  si_tin: /^(\d{8})$/,
  th_vat: /^(\d{13})$/,
  tr_tin: /^(\d{10})$/,
  tw_vat: /^(\d{8})$/,
  ua_vat: /^(\d{10}|\d{12})$/,
  us_ein: /^(\d{2}-?\d{7})$/,
  za_vat: /^(\d{10})$/,
} as const satisfies Record<TaxIdType, RegExp>;

export const getTaxIdType = (
  countryCode: CountryCode,
  taxIdValue: string,
): TaxIdType | undefined => {
  const taxIdType =
    COUNTRY_CODE_TAX_ID_TYPE_MAP[countryCode as keyof typeof COUNTRY_CODE_TAX_ID_TYPE_MAP];
  if (taxIdType) {
    return taxIdType;
  }

  // if the taxIdType is not found, try to find the correct taxId based on the value
  for (const [taxIdType, regex] of Object.entries(TAX_ID_TYPE_REGEX_MAP)) {
    if (regex.test(taxIdValue)) {
      return taxIdType as TaxIdType;
    }
  }

  return undefined;
};

export const isValidTaxId = (countryCode: CountryCode, taxIdValue: string): boolean => {
  const taxIdType = getTaxIdType(countryCode, taxIdValue);
  if (!taxIdType) {
    return false;
  }
  return true;
};

const COUNTRY_CODE_TAX_ID_REGEX_MAP = {
  DK: /^DK[0-9]{8}$/,
  NO: /^[0-9]{9}MVA$/,
} as const satisfies Partial<Record<CountryCode, RegExp>>;

/**
 * If the country code is not in the map, it will return true. This is because
 * we don't want to block the user from entering a tax id if we don't know how
 * to validate it.
 *
 * @param taxIdValue The tax id value
 * @param countryCode country code
 * @returns true if the tax id is valid, false otherwise
 */
export const frontendValidateTaxId = (taxIdValue: string, countryCode: CountryCode): boolean => {
  const isInCountryCodeMap = (
    countryCode: CountryCode,
  ): countryCode is keyof typeof COUNTRY_CODE_TAX_ID_REGEX_MAP =>
    countryCode in COUNTRY_CODE_TAX_ID_REGEX_MAP;

  if (!isInCountryCodeMap(countryCode)) {
    return taxIdValue.length > 8;
  }

  const regex = COUNTRY_CODE_TAX_ID_REGEX_MAP[countryCode];
  return regex.test(taxIdValue);
};
