// packages/shared/constants/src/lib/emulator.ts
// Single source of truth for emulator ports, hosts, project ID.

import { CLOUD_FUNCTIONS_REGION, MODE_PROJECT_MAP } from './project.ts';

// ── Project & Region ──────────────────────────────────────────
export const EMULATOR_PROJECT_ID = MODE_PROJECT_MAP.emulator;
export const EMULATOR_REGION = CLOUD_FUNCTIONS_REGION;

// ── Emulator Ports ────────────────────────────────────────────
export const EMULATOR_PORTS = {
  auth: 9099,
  functions: 5001,
  firestore: 8080,
  pubsub: 8085,
  storage: 9199,
  dataconnect: 9399,
} as const;

export const EMULATOR_HOSTS = {
  auth: `localhost:${EMULATOR_PORTS.auth}`,
  firestore: `localhost:${EMULATOR_PORTS.firestore}`,
  functions: `localhost:${EMULATOR_PORTS.functions}`,
  storage: `localhost:${EMULATOR_PORTS.storage}`,
  pubsub: `localhost:${EMULATOR_PORTS.pubsub}`,
} as const;

export const EMULATOR_HEALTH_URLS = {
  auth: `http://${EMULATOR_HOSTS.auth}`,
  firestore: `http://${EMULATOR_HOSTS.firestore}`,
} as const;

// ── Firestore REST URL builders ──────────────────────────────
/** Base URL for Firestore emulator REST API (documents). */
export function getEmulatorFirestoreUrl(): string {
  return `http://${EMULATOR_HOSTS.firestore}/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents`;
}

/** URL for Firestore emulator :runQuery endpoint. */
export function getEmulatorFirestoreRunQueryUrl(): string {
  return `http://${EMULATOR_HOSTS.firestore}/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents:runQuery`;
}

// ── Data Connect (PostgreSQL) helpers ────────────────────────

/** PostgreSQL connection string for the Data Connect emulator. */
export const EMULATOR_DATACONNECT_URL =
  'postgresql://postgres@localhost:5432/dataconnect_emulator?sslmode=disable' as const;

/**
 * Query audit logs from the Data Connect emulator's PostgreSQL.
 */
export function getAuditLogsQueryUrl(requestId: string, auditWorkerPort = 3001): string {
  return `http://localhost:${auditWorkerPort}/audit-logs?requestId=${encodeURIComponent(requestId)}`;
}
