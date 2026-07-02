// packages/shared/constants/src/lib/project.ts

export const modes = ['staging', 'production', 'emulator', 'testing'] as const;

export const defaultMode = 'staging' as const satisfies (typeof modes)[number];

/**
 * Aikami backend application identifiers.
 *
 * | App       | Location                        | Use Case                        |
 * |-----------|---------------------------------|---------------------------------|
 * | `firebase`| `apps/backend/firebase`         | Cloud Functions + Firestore     |
 */
export const backendAppIds = ['firebase'] as const;

/**
 * Aikami frontend application identifiers.
 *
 * | App            | Location                      | Use Case                              |
 * |----------------|-------------------------------|---------------------------------------|
 * | `docs`         | `apps/frontend/docs`          | Documentation site                    |
 * | `game`       | `apps/frontend/game`        | game rendering engine               |
 * | `site`         | `apps/frontend/site`           | Public marketing site                 |
 * | `client`       | `apps/frontend/client`           | Main client app (characters, chat, settings) |
 */
export const frontendAppIds = ['docs', 'site', 'client'] as const;

/**
 * All Aikami application identifiers (backend + frontend).
 */
export const appIds = [...backendAppIds, ...frontendAppIds] as const;

/**
 * Maps each Aikami deployment mode to its Firebase/GCP project ID.
 * Used by both frontend and backend apps.
 *
 * Emulator mode uses the `demo-` prefix so Firebase doesn't attempt production project lookups.
 */
export const MODE_PROJECT_MAP = {
  staging: 'aikami-dev',
  production: 'aikami-prod',
  emulator: 'demo-aikami-emulator',
  testing: 'demo-aikami-emulator',
} as const satisfies Record<(typeof modes)[number], string>;

/**
 * GCP region where Cloud Functions and Cloud Run services are deployed.
 * Must match the `region` field in `apps/backend/firebase/firestack.config.ts`.
 */
export const CLOUD_FUNCTIONS_REGION = 'europe-west1' as const;
