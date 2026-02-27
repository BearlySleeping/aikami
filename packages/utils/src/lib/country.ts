type AllCountries = typeof import('./all-countries.ts').allCountries;

let _allCountries: AllCountries | undefined;

const getAllCountries = async (): Promise<AllCountries> => {
  if (_allCountries) {
    return _allCountries;
  }

  _allCountries = await import('./all-countries.ts').then((module) => module.allCountries);

  return _allCountries as AllCountries;
};

export const getCountryData = async (
  countryCode: string,
): Promise<
  | {
      name: string;
      regions: Record<string, string>;
    }
  | undefined
> => {
  const allCountries = await getAllCountries();

  const country = allCountries.find((country) => country[1] === countryCode);
  if (!country) {
    return undefined;
  }
  const [name, _, regions] = country;
  return {
    name,
    regions: regions.reduce(
      (result, [value, key]) =>
        key
          ? {
              ...result,
              [key.toString()]: value,
            }
          : result,
      {},
    ),
  };
};
