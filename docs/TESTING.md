# Testing

This document provides an overview of the testing strategy for the Aikami project.

## Guiding Principles

-   **Test everything that can break:** We should write tests for all our code, including the frontend, backend, and shared packages.
-   **Write tests that are easy to read and maintain:** Tests should be easy to read and understand. They should also be easy to maintain as the codebase changes.
-   **Write tests that are fast and reliable:** Tests should be fast to run and should not be flaky.

## Unit Testing

Unit tests are used to test individual units of code, such as functions, classes, and components. We use the built-in Deno testing framework to write our unit tests.

### Backend

For the backend, we write unit tests for all our Firebase Functions. We use the `@firebase/testing` library to test our functions in a local emulator. This allows us to test our functions without having to deploy them to Firebase.

### Frontend

For the frontend, we write unit tests for all our Svelte components. We use the `@testing-library/svelte` library to test our components in a simulated browser environment. This allows us to test our components without having to run them in a real browser.

### Shared Packages

For the shared packages, we write unit tests for all our utility functions and classes. We use the built-in Deno testing framework to write our unit tests.

## Integration Testing

Integration tests are used to test the interaction between different parts of the system. For example, we write integration tests to test the interaction between the frontend and the backend.

We use the built-in Deno testing framework to write our integration tests. We also use the `@firebase/testing` library to test our backend in a local emulator.

## End-to-End Testing

End-to-end (E2E) tests are used to test the entire application from the user's perspective. We use Playwright to write our E2E tests.

Playwright is a Node.js library that provides a high-level API for controlling a browser. We use Playwright to simulate user interactions and to verify that the application is working correctly.

## Running the Tests

To run the tests, use the following command:

```bash
deno task test
```

This command will run all the unit tests, integration tests, and E2E tests in the project.

## Conclusion

By following this testing strategy, we can ensure that the Aikami project is a success. If you have any questions or suggestions, please feel free to open an issue or a pull request.
