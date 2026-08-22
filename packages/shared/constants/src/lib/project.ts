// packages/shared/constants/src/lib/project.ts

/**
 * Aikami backend application identifiers.
 *
 * | App       | Location                        | Use Case                        |
 * |-----------|---------------------------------|---------------------------------|
 * | `image`   | `apps/backend/image`            | ComfyUI image generation        |
 * | `text`    | `apps/backend/text`             | Ollama text generation          |
 * | `voice`   | `apps/backend/voice`            | Kokoro voice synthesis          |
 * | `worker`  | `apps/backend/worker`           | Discord Gateway bot + Interactions Endpoint (always-on Compute Engine VM) |
 */
export const backendAppIds = ['image', 'text', 'voice', 'worker'] as const;

/**
 * Aikami frontend application identifiers.
 *
 * | App            | Location                      | Use Case                              |
 * |----------------|-------------------------------|---------------------------------------|
 * | `docs`         | `apps/frontend/docs`          | Documentation site                    |
 * | `game`       | `apps/frontend/game`        | game rendering engine               |
 * | `site`         | `apps/frontend/site`           | Public marketing site                 |
 * | `client`       | `apps/frontend/client`           | Main client app (characters, chat, settings) |
 * | `client-tauri` | `apps/frontend/client`           | Tauri desktop release (same source, different deploy target) |
 * | `hub`          | `apps/frontend/hub`              | SvelteKit SSR dashboard (Cloud Run + Firebase Hosting) |
 */
export const frontendAppIds = ['docs', 'site', 'client', 'client-tauri', 'hub'] as const;

/**
 * All Aikami application identifiers (backend + frontend).
 */
export const appIds = [...backendAppIds, ...frontendAppIds] as const;

/**
 * Deployment modes that exist across the project. `MODE_PROJECT_MAP`,
 * `ModeSchema`/`Mode` (packages/shared/schemas), and `liveModes`
 * (scripts/src/lib/deploy/deployment_config.ts) are all derived from this
 * tuple — `satisfies` on MODE_PROJECT_MAP below fails to compile if the two
 * fall out of sync.
 *
 * To disable a mode across the whole project (e.g. staging, while there are
 * no active users to justify its GCP cost): comment out its entry here AND
 * in MODE_PROJECT_MAP below. Everything downstream (Mode type, liveModes,
 * deploy scripts) shrinks with it, and the compiler will point at anything
 * that still assumes it exists.
 *
 * Three call sites can't import this (documented at each) and need the same
 * mode commented out by hand: bash can't import TS
 * (scripts/direnv/bootstrap.sh's _AIKAMI_PROJECT_MAP), and .pi extensions
 * run outside the moon project graph (direnv_detect.ts, gcloud_exec.ts).
 */
export const modes = ['staging', 'production', 'emulator', 'testing'] as const;

/** Always 'production' regardless of which other modes are enabled/disabled. */
export const defaultMode = 'production' as const satisfies (typeof modes)[number];

/**
 * Maps each Aikami deployment mode to its Firebase/GCP project ID.
 * Used by both frontend and backend apps.
 *
 * Emulator mode uses the `demo-` prefix so Firebase doesn't attempt production project lookups.
 */
export const MODE_PROJECT_MAP = {
  staging: 'aikami-staging',
  production: 'aikami-production',
  emulator: 'demo-aikami-emulator',
  testing: 'demo-aikami-emulator',
} as const satisfies Record<(typeof modes)[number], string>;

/**
 * GCP region where Cloud Functions and Cloud Run services are deployed.
 * Must match the `region` field in `apps/backend/firebase/firestack.config.ts`.
 */
export const CLOUD_FUNCTIONS_REGION = 'europe-west4' as const;

/**
 * Public HTTPS base URL for the `worker` app's Elysia server
 * (apps/backend/worker) — a Cloudflare-proxied subdomain in front of the
 * VM's plain HTTP port, not a GCP-managed domain (see that app's README,
 * "HTTP surface"). Production only; there is no staging worker VM.
 */
export const WORKER_URL = 'https://worker.bearlysleeping.com' as const;

/**
 * Offset a demo Firebase project ID for contract-scoped pipeline runs, so
 * concurrent `firestack emulate` instances never collide.
 *
 * Per-port offsetting (see development_ports.ts's withPortOffset) is not
 * enough on its own: firebase-tools' Emulator Hub coordinates running
 * instances via a locator file keyed by the literal project ID
 * (`hub-${projectId}.json` in the shared OS temp dir, independent of which
 * port that hub ends up on). Two concurrent instances that both resolve to
 * the bare `demo-aikami-emulator` collide there and kill each other —
 * reproduced directly: whichever instance (re)started most recently stays
 * up, the other's port goes dark within moments, no crash log, because the
 * hub locator file gets overwritten out from under it. Suffixing the
 * project id by offset gives each contract its own locator file too.
 *
 * Only ever applied to `demo-` project ids (emulator/testing) — a
 * staging/production project id is a real GCP project and must never be
 * mutated; `offset <= 0` (manual, non-contract dev) leaves the id
 * untouched so today's exact project id keeps working everywhere it's
 * already relied on (e.g. cached emulator data, browser bookmarks to the
 * Emulator UI).
 */
export const withProjectIdOffset = (projectId: string, offset: number): string =>
  offset > 0 && projectId.startsWith('demo-') ? `${projectId}-${offset}` : projectId;
