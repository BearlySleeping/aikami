# CI/CD Pipeline

This document provides an overview of the CI/CD pipeline for the Aikami project. The pipeline is built on GitHub Actions and is designed to be fast, reliable, and secure.

## Workflows

The CI/CD pipeline is composed of several workflows, which are defined in the `.github/workflows` directory.

-   `deploy.yml`: This workflow deploys the backend to Google Cloud Run and the frontend to Firebase Hosting.
-   `ci.yml`: This workflow runs on every push and pull request to the `main` and `develop` branches. It runs tests, linting, and formatting checks.
-   `generic-checks.yml`: This workflow runs on every push and pull request to the `main` and `develop` branches. It runs generic checks, such as checking for large files and spelling errors.
-   `godot-checks.yml`: This workflow runs on every push and pull request to the `main` and `develop` branches. It runs checks specific to the Godot game client.
-   `pr-notifications.yml`: This workflow sends notifications when a pull request is opened or updated.
-   `publish-notifications.yml`: This workflow sends notifications when a new version is published.
-   `publish.yml`: This workflow publishes new versions of the packages to the npm registry.
-   `push-notifications.yml`: This workflow sends notifications when a push is made to the `main` or `develop` branches.

## Deployment

The `deploy.yml` workflow is the most important workflow in the CI/CD pipeline. It deploys the backend to Google Cloud Run and the frontend to Firebase Hosting.

The workflow is triggered by a push to the `main` branch or a tag that starts with `v`. It can also be triggered manually.

The workflow has the following jobs:

-   `determine-environment`: This job determines the environment to deploy to. If the workflow is triggered by a push to the `main` branch, the environment is `staging`. If the workflow is triggered by a tag that starts with `v`, the environment is `production`. If the workflow is triggered manually, the environment is selected from a dropdown list.
-   `build-backend`: This job builds the backend Docker image and pushes it to Google Container Registry.
-   `build-frontend`: This job builds the frontend and uploads the build artifacts.
-   `deploy-backend`: This job deploys the backend to Google Cloud Run.
-   `deploy-frontend`: This job deploys the frontend to Firebase Hosting.
-   `integration-test`: This job runs integration tests against the staging environment.
-   `rollback`: This job rolls back the backend to the previous revision if the deployment fails.
-   `notify`: This job sends a notification to a Slack channel to report the status of the deployment.

### Environments

The CI/CD pipeline has two environments:

-   **Staging:** The staging environment is used for testing and QA. It is deployed to on every push to the `main` branch.
-   **Production:** The production environment is the live environment that is used by end-users. It is deployed to when a new version is tagged.

### Secrets

The CI/CD pipeline uses a number of secrets to deploy the application. These secrets are stored in the GitHub repository and are injected into the workflow at runtime.

-   `GCP_PROJECT_ID`: The ID of the Google Cloud project.
-   `GCP_SA_KEY`: The service account key for the Google Cloud project.
-   `FIREBASE_PROJECT_ID`: The ID of the Firebase project.
-   `FIREBASE_TOKEN`: The Firebase authentication token.
-   `PUBLIC_FIREBASE_API_KEY_PROD`: The Firebase API key for the production environment.
-   `PUBLIC_FIREBASE_AUTH_DOMAIN_PROD`: The Firebase auth domain for the production environment.
-   `PUBLIC_FIREBASE_PROJECT_ID_PROD`: The Firebase project ID for the production environment.
-   `PUBLIC_FIREBASE_STORAGE_BUCKET_PROD`: The Firebase storage bucket for the production environment.
-   `PUBLIC_FIREBASE_MESSAGING_SENDER_ID_PROD`: The Firebase messaging sender ID for the production environment.
-   `PUBLIC_FIREBASE_APP_ID_PROD`: The Firebase app ID for the production environment.
-   `PUBLIC_FIREBASE_MEASUREMENT_ID_PROD`: The Firebase measurement ID for the production environment.
-   `PUBLIC_API_BASE_URL_PROD`: The API base URL for the production environment.
-   `PUBLIC_FIREBASE_API_KEY_STAGING`: The Firebase API key for the staging environment.
-   `PUBLIC_FIREBASE_AUTH_DOMAIN_STAGING`: The Firebase auth domain for the staging environment.
--   `PUBLIC_FIREBASE_PROJECT_ID_STAGING`: The Firebase project ID for the staging environment.
-   `PUBLIC_FIREBASE_STORAGE_BUCKET_STAGING`: The Firebase storage bucket for the staging environment.
-   `PUBLIC_FIREBASE_MESSAGING_SENDER_ID_STAGING`: The Firebase messaging sender ID for the staging environment.
-   `PUBLIC_FIREBASE_APP_ID_STAGING`: The Firebase app ID for the staging environment.
-   `PUBLIC_FIREBASE_MEASUREMENT_ID_STAGING`: The Firebase measurement ID for the staging environment.
-   `PUBLIC_API_BASE_URL_STAGING`: The API base URL for the staging environment.
