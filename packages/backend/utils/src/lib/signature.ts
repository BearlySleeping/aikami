import { createHmac } from 'node:crypto';

/**
 * Verifies the signature of the request.
 *
 * @param options - Options for verifying the signature.
 * @param options.signature The signature received in the request header.
 * @param options.body The body of the request.
 * @param options.secret The shared secret used to generate the signature.
 * @returns Returns true if the signature is valid, false otherwise.
 */
export const verifySignature = (options: {
  body: Record<string, unknown>;
  secret: string;
  signature: string;
}): boolean => {
  const { body, secret, signature } = options;
  const expectedSignature = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');

  return signature === `sha256=${expectedSignature}`;
};

/**
 * Creates a signature for a given request body and secret. The signature is
 * generated using the HMAC SHA-256 hash function.
 *
 * @param options - Options for creating the signature.
 * @param options.body - The body of the request to be signed.
 * @param options.secret - The secret key used for generating the HMAC
 *   signature.
 * @returns The generated HMAC SHA-256 signature in hexadecimal format, prefixed
 *   with 'sha256='.
 */
export const createSignature = (options: { body: Record<string, unknown>; secret: string }) => {
  const { body, secret } = options;
  return `sha256=${createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;
};
