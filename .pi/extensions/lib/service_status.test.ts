// .pi/extensions/lib/service_status.test.ts

import { describe, expect, test } from 'bun:test';
import { formatServiceStatus } from './service_status.ts';

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
    expect(formatServiceStatus({ ...service, readyPort: undefined })).not.toContain('✅');
  });

  test('stopped service is not ready even with stale status metadata', () => {
    expect(formatServiceStatus({ ...service, running: false })).toContain('not running');
  });
});
