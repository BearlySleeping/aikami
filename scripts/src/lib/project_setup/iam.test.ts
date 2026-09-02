// scripts/src/lib/project_setup/iam.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';

const commands: string[][] = [];
let secretGrantCode = 0;

const run = mock(async (command: string[]) => {
  commands.push(command);

  if (command.includes('service-accounts') && command.includes('describe')) {
    return { out: '', err: '', code: 0 };
  }
  if (command.includes('projects') && command.includes('get-iam-policy')) {
    if (command.some((argument) => argument.includes('bindings.members:user:'))) {
      return { out: '[]', err: '', code: 0 };
    }
    return {
      out: JSON.stringify([
        { bindings: { role: 'roles/artifactregistry.writer', members: [] } },
        { bindings: { role: 'roles/compute.instanceAdmin.v1', members: [] } },
        { bindings: { role: 'roles/artifactregistry.reader', members: [] } },
      ]),
      err: '',
      code: 0,
    };
  }
  if (command.includes('get-iam-policy')) {
    return { out: '[]', err: '', code: 0 };
  }
  if (command.includes('add-iam-policy-binding')) {
    return { out: '', err: '', code: secretGrantCode };
  }
  return { out: '', err: '', code: 1 };
});

mock.module('../cli_utils', () => ({
  c: { bold: '', cyan: '', green: '', red: '', reset: '', white: '' },
  fmt: {
    err: (message: string) => message,
    fix: (message: string) => message,
    head: (message: string) => message,
    note: (message: string) => message,
    ok: (message: string) => message,
    section: (message: string) => message,
    warn: (message: string) => message,
  },
  parseCliArgs: () => ({}),
  run,
}));

mock.module('./secrets_manager', () => ({
  getWorkerRuntimeSecretIds: () => ['WORKER_RUNTIME_SECRET'],
}));

const { setupIam } = await import('./iam');

describe('setupIam per-secret access', () => {
  beforeEach(() => {
    commands.length = 0;
    secretGrantCode = 0;
  });

  test('grants the runtime service account access to every required secret', async () => {
    const result = await setupIam(
      'aikami-production',
      'deploy@example.iam.gserviceaccount.com',
      false,
      'worker@example.iam.gserviceaccount.com',
    );

    expect(
      commands.some(
        (command) =>
          command.includes('WORKER_RUNTIME_SECRET') &&
          command.includes('--member=serviceAccount:worker@example.iam.gserviceaccount.com') &&
          command.includes('--role=roles/secretmanager.secretAccessor'),
      ),
    ).toBe(true);
    expect(result.checks.some((check) => check.fixed)).toBe(true);
  });

  test('surfaces a failed per-secret grant as a setup error', async () => {
    secretGrantCode = 1;

    const result = await setupIam(
      'aikami-production',
      'deploy@example.iam.gserviceaccount.com',
      false,
      'worker@example.iam.gserviceaccount.com',
    );

    expect(result.checks).toContainEqual({
      name: 'IAM: roles/secretmanager.secretAccessor on WORKER_RUNTIME_SECRET',
      status: 'error',
    });
  });
});
