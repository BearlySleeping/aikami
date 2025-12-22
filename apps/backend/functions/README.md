# Functions

This app contains the backend functions for the Aikami project. The functions are written in TypeScript and run on Firebase Functions.

## Installation

This app is a dependency of other packages in the monorepo and is not meant to be used as a standalone app.

## Usage

The functions are deployed to Firebase and are triggered by HTTP requests or other Firebase events.

## Functions

### `test`

This is a test function that uses Genkit to chat with the Google AI. It also retrieves user data from the database.

To use this function, send a POST request to the `/test` endpoint with a JSON body like this:

```json
{
  "prompt": "Hello there!"
}
```

The function will respond with a JSON object containing the chat response and the user data.
