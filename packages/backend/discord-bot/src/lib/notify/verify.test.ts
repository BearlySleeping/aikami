// packages/backend/discord-bot/src/lib/notify/verify.test.ts

import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { verifyNotifySignature } from './verify';

const SECRET = 'test-secret';
const BODY = Buffer.from(JSON.stringify({ channel: 'staff', embed: { title: 'hi' } }), 'utf8');

function sign(timestamp: string, rawBody: Buffer, secret = SECRET): string {
  const message = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
  return `sha256=${createHmac('sha256', secret).update(message).digest('hex')}`;
}

describe('verifyNotifySignature', () => {
  it('accepts a correctly signed request within the replay window', () => {
    const now = Date.now();
    const timestamp = String(now);
    const signature = sign(timestamp, BODY);

    expect(
      verifyNotifySignature({ signature, timestamp, rawBody: BODY, secret: SECRET, now }),
    ).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const now = Date.now();
    const timestamp = String(now);
    const signature = sign(timestamp, BODY, 'wrong-secret');

    expect(
      verifyNotifySignature({ signature, timestamp, rawBody: BODY, secret: SECRET, now }),
    ).toBe(false);
  });

  it('rejects a signature computed over a different body (tampered payload)', () => {
    const now = Date.now();
    const timestamp = String(now);
    const signature = sign(timestamp, BODY);
    const tamperedBody = Buffer.from(JSON.stringify({ channel: 'admin', embed: {} }), 'utf8');

    expect(
      verifyNotifySignature({
        signature,
        timestamp,
        rawBody: tamperedBody,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it('rejects a timestamp older than the 5-minute replay window', () => {
    const now = Date.now();
    const timestamp = String(now - 6 * 60 * 1000);
    const signature = sign(timestamp, BODY);

    expect(
      verifyNotifySignature({ signature, timestamp, rawBody: BODY, secret: SECRET, now }),
    ).toBe(false);
  });

  it('rejects a timestamp from the future beyond the replay window (clock skew abuse)', () => {
    const now = Date.now();
    const timestamp = String(now + 6 * 60 * 1000);
    const signature = sign(timestamp, BODY);

    expect(
      verifyNotifySignature({ signature, timestamp, rawBody: BODY, secret: SECRET, now }),
    ).toBe(false);
  });

  it('accepts a timestamp right at the edge of the replay window', () => {
    const now = Date.now();
    const timestamp = String(now - 4 * 60 * 1000 - 59 * 1000); // 4m59s old
    const signature = sign(timestamp, BODY);

    expect(
      verifyNotifySignature({ signature, timestamp, rawBody: BODY, secret: SECRET, now }),
    ).toBe(true);
  });

  it('rejects a missing signature header', () => {
    const timestamp = String(Date.now());
    expect(
      verifyNotifySignature({ signature: undefined, timestamp, rawBody: BODY, secret: SECRET }),
    ).toBe(false);
  });

  it('rejects a missing timestamp header', () => {
    const signature = sign(String(Date.now()), BODY);
    expect(
      verifyNotifySignature({ signature, timestamp: undefined, rawBody: BODY, secret: SECRET }),
    ).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    const signature = sign('not-a-number', BODY);
    expect(
      verifyNotifySignature({
        signature,
        timestamp: 'not-a-number',
        rawBody: BODY,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a malformed (wrong-length) signature without throwing', () => {
    const timestamp = String(Date.now());
    expect(() =>
      verifyNotifySignature({
        signature: 'sha256=deadbeef',
        timestamp,
        rawBody: BODY,
        secret: SECRET,
      }),
    ).not.toThrow();
    expect(
      verifyNotifySignature({
        signature: 'sha256=deadbeef',
        timestamp,
        rawBody: BODY,
        secret: SECRET,
      }),
    ).toBe(false);
  });
});
