# Constants

This package contains all the constant values used across the Aikami project.

## Installation

This package is a dependency of other packages in the monorepo and is not meant to be used as a standalone package.

## Usage

To use the constants from this package, import them from `@aikami/constants`:

```typescript
import { userRoles } from '@aikami/constants'
```

## Constants

### `auth.ts`

- `userRoles`: An array of user roles.
  - `member`
  - `superAdmin`
- `userStatuses`: An array of user statuses.
  - `active`
  - `trialing`
  - `unpaid`
  - `canceled`
  - `inactive`
  - `unconfirmed`
- `firebaseSignInProviderNames`: An array of Firebase sign-in provider names.
  - `google`
  - `github`

### `country-codes.ts`

- `allCountries`: An array of all countries with their names, ISO codes, and phone codes.

### `country-codes-phone-number.ts`

- `countryCodes`: An array of all countries with their names and phone codes.

### `locale-codes.ts`

- `locales`: An array of all locales with their codes and names.

### `location.ts`

- `commonLocations`: An array of common locations.
- `commonLocationObjects`: An array of common location objects.

### `logger.ts`

- `logLevels`: An array of log levels.
  - `debug`
  - `info`
  - `warn`
  - `error`

### `regex.ts`

- `emailRegex`: A regular expression for validating email addresses.
- `passwordRegex`: A regular expression for validating passwords.

### `router.ts`

- `routes`: An object containing all the routes for the PWA.

### `transform.ts`

- `stringToBoolean`: A function that converts a string to a boolean.
- `stringToNumber`: A function that converts a string to a number.

### `common.ts`

- `EMPTY_STRING`: An empty string.
- `EMPTY_ARRAY`: An empty array.
- `EMPTY_OBJECT`: An empty object.
- `isClient`: A boolean that is true if the code is running on the client.
- `isServer`: A boolean that is true if the code is running on the server.
- `isDev`: A boolean that is true if the code is running in development mode.
- `isProd`: A boolean that is true if the code is running in production mode.
