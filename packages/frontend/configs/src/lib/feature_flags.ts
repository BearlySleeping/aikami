// packages/frontend/configs/src/lib/feature-flags.ts
import { publicEnv } from './environment';

/**
 * Feature flag definitions for the frontend.
 * Backed by environment variables to allow per-environment configuration.
 */
export const featureFlags = {
  /** Enable Firestore offline persistence */
  offlinePersistence: publicEnv.PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE === '1',

  /** Enable Gmail integration */
  gmailIntegration: Boolean(publicEnv.PUBLIC_GMAIL_CLIENT_ID),

  /** Enable push notifications */
  pushNotifications: Boolean(publicEnv.PUBLIC_VAPID_KEY),

  /** Enable app check */
  appCheck: publicEnv.PUBLIC_DISABLE_APP_CHECK !== '1',

  /**
   * QA/CI bypass flag for text AI capability gate.
   * When '1', allows gameplay without a resolved text AI provider.
   * MUST be '0' or absent in production builds.
   *
   * Contract: C-335 AC-4 — AI capability gate enforcement
   */
  qaBypassTextAi: publicEnv.PUBLIC_QA_BYPASS_TEXT_AI === '1',
} as const;

export type FeatureFlags = typeof featureFlags;
