# Mocks

This package provides a set of mock data that can be used in tests and for development.

## Installation

This package is a dependency of other packages in the monorepo and is not meant to be used as a standalone package.

## Usage

To use the mocks from this package, import them from `@aikami/mocks`:

```typescript
import { mockDate } from '@aikami/mocks'
```

## Mocks

- `mockDate`: A mock date.
- `mockUID`: A mock user ID.
- `mockTeamId`: A mock team ID.
- `mockThumbnailURL`: A mock thumbnail URL.
- `mockGifURL`: A mock GIF URL.
- `mockWebmURL`: A mock WebM URL.
- `mockDescription`: A mock description.
- `mockDescriptionLite`: A mock lite description.
- `mockFirstName`: A mock first name.
- `mockLastName`: A mock last name.
- `getRandomId`: A function that returns a random ID.
