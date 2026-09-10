// .pi/extensions/lib/bridge.test.ts

import { describe, expect, test } from 'bun:test';
import { parseBridgeEnvelope } from './bridge.ts';

describe('parseBridgeEnvelope', () => {
  test.each(['null', '{"ok":false}', '{"ok":true}'])('rejects malformed envelope %s', (stdout) => {
    expect(() => parseBridgeEnvelope({ command: 'test.command', stdout })).toThrow(
      expect.objectContaining({ name: 'BridgeProtocolError' }),
    );
  });
});
