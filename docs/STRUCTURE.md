# Structure

This document provides an overview of the project structure for the Aikami project.

## Monorepo

The Aikami project is a monorepo that is managed by [**Moon**](https://moonrepo.dev/). The monorepo is organized into the following directories:

-   `apps`: This directory contains the applications that are part of the Aikami project.
-   `packages`: This directory contains the shared packages that are used by the applications.
-   `docs`: This directory contains the documentation for the Aikami project.
-   `.github`: This directory contains the GitHub Actions workflows for the CI/CD pipeline.
-   `.moon`: This directory contains the configuration for Moon.
-   `.rules`: This directory contains the custom rules for the linter.
-   `.zed`: This directory contains the configuration for the Zed editor.

## Applications

The `apps` directory contains the following applications:

-   `backend`: This directory contains the backend for the Aikami project. The backend is built on Firebase and is composed of the following services:
    -   `ai`: This directory contains the AI models for the Aikami project.
    -   `functions`: This directory contains the Firebase Functions for the Aikami project.
    -   `rules`: This directory contains the Firestore rules for the Aikami project.
-   `frontend`: This directory contains the frontend for the Aikami project. The frontend is composed of the following applications:
    -   `docs`: This directory contains the documentation website for the Aikami project. The documentation website is built with Astro.
    -   `game`: This directory contains the Godot game client for the Aikami project.
    -   `landing_page`: This directory contains the landing page for the Aikami project. The landing page is built with Astro.
    -   `pwa`: This directory contains the Progressive Web App (PWA) for the Aikami project. The PWA is built with SvelteKit.

## Packages

The `packages` directory contains the following shared packages:

-   `backend`: This directory contains the backend packages that are used by the backend applications.
    -   `ai`: This directory contains the AI package that is used by the backend applications.
    -   `auth`: This directory contains the authentication package that is used by the backend applications.
    -   `configs`: This directory contains the configuration package that is used by the backend applications.
    -   `database`: This directory contains the database package that is used by the backend applications.
    -   `svelte-kit`: This directory contains the SvelteKit package that is used by the backend applications.
    -   `utils`: This directory contains the utility package that is used by the backend applications.
-   `constants`: This directory contains the constants that are used by the applications.
-   `frontend`: This directory contains the frontend packages that are used by the frontend applications.
    -   `repositories`: This directory contains the repository package that is used by the frontend applications.
    -   `services`: This directory contains the service package that is used by the frontend applications.
    -   `utils`: This directory contains the utility package that is used by the frontend applications.
-   `logger`: This directory contains the logger that is used by the applications. The logger has environment-specific implementations:

    -   `logger-functions.ts`: For Firebase Cloud Functions (uses `firebase-functions/logger`)
    -   `logger-browser.ts`: For browser-based frontend applications
    -   `svelte-kit.ts`: For SvelteKit server-side rendering
    -   `svelte-kit-ssr.ts`: For SvelteKit SSR (legacy compatibility)

    Use the `$logger` path alias to import the appropriate logger for your environment. Never import from `@aikami/logger` directly.
-   `mocks`: This directory contains the mocks that are used by the applications.
-   `schemas`: This directory contains the Zod schemas that are used by the applications.
-   `types`: This directory contains the TypeScript types that are used by the applications.
-   `utils`: This directory contains the utility functions that are used by the applications.

## Conclusion

By organizing the project in this way, we can ensure that the codebase is clean, consistent, and easy to maintain. If you have any questions or suggestions, please feel free to open an issue or a pull request.