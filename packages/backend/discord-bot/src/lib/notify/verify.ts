// packages/backend/discord-bot/src/lib/notify/verify.ts
//
// Verifies the shared-secret HMAC the /notify relay's caller
// (scripts/src/lib/discord/post.ts) attaches to every request. Unlike
// ../interactions/verify.ts (Discord's own Ed25519 signature on inbound
// Interactions), this is OUR scheme securing an endpoint Discord itself
// never calls — CI holding only WORKER_NOTIFY_SECRET (not the bot token)
// is the whole point of TASK 4, so a plain shared-secret HMAC is enough;
// there's no reason to invent anything fancier.
//
// Message signed is `${timestamp}.${rawBody}` (timestamp = Unix
// milliseconds, as a string) — mirrors the header the caller sends:
// `x-aikami-timestamp` / `x-aikami-signature: sha256=<hex>`.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Requests older (or newer — clock skew) than this are rejected, even with a valid signature. */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

const computeSignature = (options: {
  timestamp: string;
  rawBody: Buffer;
  secret: string;
}): string => {
  const { timestamp, rawBody, secret } = options;
  const message = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
  return `sha256=${createHmac('sha256', secret).update(message).digest('hex')}`;
};

/** Verifies relay authenticity and rejects signatures outside the replay window. */
export const verifyNotifySignature = (options: {
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: Buffer;
  secret: string;
  /** Injectable for tests — defaults to the real clock. */
  now?: number;
}): boolean => {
  const { signature, timestamp, rawBody, secret, now = Date.now() } = options;
  if (!signature || !timestamp) {
    return false;
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > REPLAY_WINDOW_MS) {
    return false;
  }

  const expected = computeSignature({ timestamp, rawBody, secret });
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on a length mismatch rather than returning
  // false — an attacker-controlled signature of the wrong length is
  // exactly the case this needs to handle without throwing.
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
};
