// .pi/extensions/lib/service_status.test.ts

import { describe, expect, test } from 'bun:test';
import { formatServiceStatus, formatWorkspaceServiceStatus } from './service_status.ts';

const service = {
  name: 'client',
  running: true,
  readyPort: 5274,
  state: 'healthy',
  portOpen: true,
};

describe('canonical service status presentation', () => {
  test('identity-verified ready service has a positive control', () => {
    expect(formatServiceStatus(service)).toContain('✅');
    expect(formatServiceStatus(service)).toContain('identity-verified');
  });

  test.each(['unavailable', 'crashed', 'booting', 'unknown'])(
    'open port with %s readiness is not green',
    (state) => {
      expect(formatServiceStatus({ ...service, state })).not.toContain('✅');
    },
  );

  test('unprobed panes cannot claim identity-verified readiness', () => {
    const status = formatServiceStatus({ ...service, readyPort: undefined });
    expect(status).toContain('running (no port check)');
    expect(status).not.toContain('identity-verified');
  });

  test('stopped service is not ready even with stale status metadata', () => {
    expect(formatServiceStatus({ ...service, running: false })).toContain('not running');
  });
});

test('status selects the requested service within the current workspace', () => {
  const sessions = [
    { name: 'foreign', services: [{ ...service, service: 'client', name: 'foreign-client' }] },
    {
      name: 'owned',
      services: [
        { ...service, service: 'hub', name: 'owned-hub' },
        { ...service, service: 'client', name: 'owned-client' },
      ],
    },
  ];
  expect(
    formatWorkspaceServiceStatus({ sessions, workspace: 'owned', service: 'client' }),
  ).toContain('owned-client');
  expect(formatWorkspaceServiceStatus({ sessions, workspace: 'missing', service: 'client' })).toBe(
    '⏸️ client — not running',
  );
  expect(
    formatWorkspaceServiceStatus({
      sessions: sessions.slice(0, 1),
      workspace: 'owned',
      service: 'client',
    }),
  ).toBe('⏸️ client — not running');
});
