# Utils

This package contains all the utility functions used across the Aikami project.

## Installation

This package is a dependency of other packages in the monorepo and is not meant to be used as a standalone package.

## Usage

To use the utils from this package, import them from `@aikami/utils`:

```typescript
import { getErrorMessage } from '@aikami/utils'
```

## Utils

This package is organized into the following categories:

- **API:** Utils for the external APIs that the backend interacts with.
- **Common:** Utils that are shared between the frontend and the backend.
- **Database:** Utils for the Firestore database.
- **Form:** Utils for the forms in the PWA.
- **Repository:** Utils for the repositories.

### API

- `stripe.ts`: Utils for the Stripe API.

### Common

- `api-handler.ts`: Utils for handling API requests.
- `base-class.ts`: A base class for other classes to extend.
- `converters.ts`: Utils for converting data.
- `deferred.ts`: A deferred promise implementation.
- `device.ts`: Utils for detecting the user's device.
- `error.ts`: Utils for handling errors.
- `file.ts`: Utils for working with files.
- `limit.ts`: Utils for limiting the number of promises that can run concurrently.
- `listener.ts`: A listener implementation.
- `utils.ts`: Miscellaneous utils.
- `country.ts`: Utils for working with countries.

### Database

- `firestore-data-converters.ts`: Firestore data converters.
- `geohash.ts`: Utils for working with geohashes.
- `firestore-paths.ts`: Utils for creating Firestore paths.

### Form

- `oauth2.ts`: Utils for OAuth2.
- `validation.ts`: Utils for form validation.
- `auth.ts`: Utils for authentication forms.

### Repository

- `base-repository-class.ts`: A base class for repositories.

### Other

- `transform.ts`: Utils for transforming data.
- `auth.ts`: Various authentication-related utils.
- `device.ts`: Utils for detecting the user's device.
