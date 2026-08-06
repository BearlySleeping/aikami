// packages/backend/svelte-kit/src/lib/gcp_oidc.ts
//
// OIDC Identity Token generation for service-to-service auth.
// SvelteKit servers on Cloud Run fetch a GCP-issued OIDC token
// targeting the Edge Proxy audience for internal authentication.

import { logger } from '$logger';

/**
 * Fetch a GCP OIDC Identity Token from the Cloud Run metadata server.
 *
 * In production (Cloud Run), the metadata server issues a signed JWT
 * with audience, issuer, and expiration claims. In local development,
 * returns a dummy token for use with the Edge Proxy's IS_DEMO bypass.
 *
 * @param audience — The target service URL
 * @returns A signed OIDC identity token (or dummy token in local dev)
 */
export const getServiceIdentityToken = async (audience: string): Promise<string> => {
  // ── Local development / non-production fallback ──────────────
  // Only return the dev token in emulator mode. Staging uses the real
  // GCP Metadata Server (Cloud Run service account). When AIKAMI_MODE is
  // unset or any other value, fail closed by hitting the metadata server.
  if (process.env.AIKAMI_MODE === 'emulator') {
    logger.debug('gcp_oidc: using dev token (emulator mode)');
    return 'dev-oidc-token';
  }

  // ── GCP Metadata Server (Cloud Run / GCE) ─────────────────────
  try {
    const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;

    const response = await fetch(url, {
      headers: {
        'Metadata-Flavor': 'Google',
      },
      // Abort if the metadata server does not respond (SSR must not hang).
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error('gcp_oidc: metadata server returned non-OK', {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`GCP Metadata server returned ${response.status}: ${response.statusText}`);
    }

    const token = await response.text();
    if (!token) {
      throw new Error('GCP Metadata server returned empty token');
    }

    logger.debug('gcp_oidc: token fetched successfully');
    return token;
  } catch (error) {
    logger.error('gcp_oidc: failed to fetch identity token', error);
    throw error;
  }
};
