// packages/backend/discord-bot/src/lib/interactions/verify.ts
//
// Verifies the Ed25519 signature Discord attaches to every Interactions
// Endpoint request (X-Signature-Ed25519 / X-Signature-Timestamp headers).
// Required by Discord — an endpoint that doesn't verify this can be spoofed
// by anyone who finds the URL, since there's no other auth on this route.
//
// Uses tweetnacl directly rather than the `discord-interactions` package —
// it's the same primitive that package wraps, and this repo already avoids
// pulling in Discord SDKs beyond what's strictly needed (see scripts/src/
// lib/discord/client.ts's REST-only rationale).

import nacl from 'tweetnacl';

export function verifyDiscordSignature(options: {
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: Buffer;
  publicKey: string;
}): boolean {
  const { signature, timestamp, rawBody, publicKey } = options;
  if (!signature || !timestamp) {
    return false;
  }

  try {
    const message = Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]);
    return nacl.sign.detached.verify(
      message,
      Buffer.from(signature, 'hex'),
      Buffer.from(publicKey, 'hex'),
    );
  } catch {
    // Malformed hex in either header — treat as an invalid signature, not a crash.
    return false;
  }
}
