// apps/frontend/pwa/src/lib/client/utils/crypto_vault.ts
//
// AES-GCM encryption wrapper using the Web Crypto API.
// API keys and secrets are encrypted at rest in localStorage under `aikami_vault`.
// If no custom master password is set, falls back to a deterministic local
// machine fingerprint derived from navigator and screen properties.

import { logger } from '$logger';

/** localStorage key for the encrypted vault payload. */
const VAULT_KEY = 'aikami_vault';

/** AES-GCM algorithm identifier for key generation and encryption. */
const ALGORITHM = { name: 'AES-GCM', length: 256 } as const;

/** PBKDF2 parameters for deriving a CryptoKey from the raw PIN. */
const PBKDF2_PARAMS = {
  hash: 'SHA-256',
  iterations: 100_000,
  name: 'PBKDF2',
} as const;

/** Salt bytes generated once per origin and stored alongside the ciphertext. */
const SALT_LENGTH = 16;

/** IV length in bytes for AES-GCM (recommended: 12). */
const IV_LENGTH = 12;

/**
 * Builds a deterministic machine fingerprint when the user has not set a
 * custom master password. Derived from stable browser properties.
 *
 * @returns A deterministic string fingerprint for the current browser/machine.
 */
const getMachineFingerprint = (): string => {
  const parts = [
    navigator.hardwareConcurrency,
    navigator.language,
    navigator.platform,
    screen.colorDepth,
    screen.width,
    screen.height,
    new Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  return parts.join('|');
};

/**
 * Derives an AES-GCM CryptoKey from a PIN string and salt.
 *
 * @param pin - The raw PIN or passphrase.
 * @param salt - Crypto-safe random salt bytes.
 * @returns A derived CryptoKey suitable for AES-GCM.
 */
const deriveKey = async (pin: string, salt: BufferSource): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { ...PBKDF2_PARAMS, salt },
    keyMaterial,
    ALGORITHM,
    false,
    ['encrypt', 'decrypt'],
  );
};

/**
 * Encrypts a plaintext string with AES-GCM using the given PIN.
 * Stores the resulting cipher (salt + IV + ciphertext, all base64-encoded)
 * in localStorage under `aikami_vault`.
 *
 * @param options.text - The plaintext to encrypt.
 * @param options.pin - Optional custom PIN. Defaults to the machine fingerprint.
 */
export const encrypt = async (options: {
  text: string;
  pin?: string;
}): Promise<void> => {
  logger.debug('encrypt', { textLength: options.text.length });

  const pin = options.pin || getMachineFingerprint();
  const saltBuffer = new ArrayBuffer(SALT_LENGTH);
  crypto.getRandomValues(new Uint8Array(saltBuffer));
  const ivBuffer = new ArrayBuffer(IV_LENGTH);
  crypto.getRandomValues(new Uint8Array(ivBuffer));

  // Bun's Crypto type definitions return Uint8Array<ArrayBufferLike> from
  // getRandomValues, which isn't assignable to Web Crypto's BufferSource.
  // Reconstruct from a bare ArrayBuffer to satisfy the type checker.
  const salt = new Uint8Array(saltBuffer);
  const iv = new Uint8Array(ivBuffer);

  const key = await deriveKey(pin, salt);
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { ...ALGORITHM, iv },
    key,
    encoder.encode(options.text),
  );

  // Pack salt + IV + ciphertext into a single base64 string.
  const packed = new Uint8Array(
    salt.byteLength + iv.byteLength + ciphertext.byteLength,
  );
  packed.set(salt, 0);
  packed.set(iv, salt.byteLength);
  packed.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);

  localStorage.setItem(VAULT_KEY, btoa(String.fromCharCode(...packed)));
};

/**
 * Decrypts the vault cipher from localStorage.
 *
 * @param options.pin - Optional custom PIN. Defaults to the machine fingerprint.
 * @returns The decrypted plaintext, or `undefined` if no vault exists or
 *          decryption fails (wrong PIN, tampered data).
 */
export const decrypt = async (options: {
  pin?: string;
}): Promise<string | undefined> => {
  logger.debug('decrypt');

  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    const pin = options.pin || getMachineFingerprint();
    const packed = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));

    const salt = packed.slice(0, SALT_LENGTH);
    const iv = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH);

    const key = await deriveKey(pin, salt);
    const decoder = new TextDecoder();
    const plaintext = await crypto.subtle.decrypt(
      { ...ALGORITHM, iv },
      key,
      ciphertext,
    );

    return decoder.decode(plaintext);
  } catch {
    // Wrong PIN or corrupted vault — silently return undefined.
    return undefined;
  }
};

/**
 * Removes the vault from localStorage.
 */
export const clearVault = (): void => {
  logger.debug('clearVault');
  localStorage.removeItem(VAULT_KEY);
};
