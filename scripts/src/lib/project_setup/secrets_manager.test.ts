// scripts/src/lib/project_setup/secrets_manager.test.ts

import { describe, expect, test } from 'bun:test';
import { getWorkerRuntimeSecretIds } from './secrets_manager';

describe('worker runtime Secret Manager configuration', () => {
  test('covers environment and direct TLS secrets but excludes the deploy credential', () => {
    const secretIds = getWorkerRuntimeSecretIds();

    expect(secretIds).toContain('DISCORD_BOT_TOKEN');
    expect(secretIds).toContain('WORKER_TLS_CERT');
    expect(secretIds).toContain('WORKER_TLS_KEY');
    expect(secretIds).not.toContain('GCP_SA_KEY_JSON');
  });
});
