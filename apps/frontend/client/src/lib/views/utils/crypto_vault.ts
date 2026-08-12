// apps/frontend/client/src/lib/utils/crypto_vault.ts
//
// AES-GCM encryption wrapper using the Web Crypto API.
// API keys and secrets are encrypted at rest in localStorage under `aikami_vault`.
// If no custom master PIN is set, encryption is keyed by a random per-origin
// secret (not derivable from browser attributes). Vaults encrypted with the
// legacy machine-fingerprint key are migrated to that secret on first read.

import { logger } from '$logger';

/** localStorage key for the encrypted vault payload. */
const VAULT_KEY = 'aikami_vault';

/** localStorage key for the random per-origin vault secret. */
const VAULT_SECRET_KEY = 'aikami_vault_secret';

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
 * Random per-origin vault secret, generated once and persisted. Replaces the
 * old machine-fingerprint key: a fingerprint is predictable from public
 * browser attributes; this secret is not derivable without reading storage.
 * Persisted so the vault stays readable across reloads on the same origin.
 *
 * @returns The per-origin vault secret string.
 */
const getVaultSecret = (): string => {
  let secret = localStorage.getItem(VAULT_SECRET_KEY);
  if (!secret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(VAULT_SECRET_KEY, secret);
  }
  return secret;
};

/**
 * Legacy deterministic machine fingerprint — kept ONLY to migrate vaults
 * encrypted before the random secret existed. Not used for new writes.
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
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey({ ...PBKDF2_PARAMS, salt }, keyMaterial, ALGORITHM, false, [
    'encrypt',
    'decrypt',
  ]);
};

/**
 * Attempts to decrypt the packed vault payload with the given PIN.
 *
 * @param pin - The PIN/passphrase to try.
 * @param raw - The packed base64 vault payload from localStorage.
 * @returns The decrypted plaintext, or undefined on any failure.
 */
const decryptWith = async (pin: string, raw: string): Promise<string | undefined> => {
  try {
    const packed = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));

    const salt = packed.slice(0, SALT_LENGTH);
    const iv = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH);

    const key = await deriveKey(pin, salt);
    const decoder = new TextDecoder();
    const plaintext = await crypto.subtle.decrypt({ ...ALGORITHM, iv }, key, ciphertext);

    return decoder.decode(plaintext);
  } catch {
    // Wrong PIN or corrupted vault — return undefined.
    return undefined;
  }
};

/**
 * Encrypts a plaintext string with AES-GCM using the given PIN.
 * Stores the resulting cipher (salt + IV + ciphertext, all base64-encoded)
 * in localStorage under `aikami_vault`.
 *
 * When no PIN is supplied, keys off the per-origin random secret (never the
 * machine fingerprint).
 *
 * @param options.text - The plaintext to encrypt.
 * @param options.pin - Optional custom PIN. Defaults to the per-origin secret.
 */
export const encrypt = async (options: { text: string; pin?: string }): Promise<void> => {
  logger.debug('encrypt', { textLength: options.text.length });

  const pin = options.pin || getVaultSecret();
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
  const packed = new Uint8Array(salt.byteLength + iv.byteLength + ciphertext.byteLength);
  packed.set(salt, 0);
  packed.set(iv, salt.byteLength);
  packed.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);

  localStorage.setItem(VAULT_KEY, btoa(String.fromCharCode(...packed)));
};

/**
 * Decrypts the vault cipher from localStorage.
 *
 * Tries the supplied PIN (or the per-origin secret) first. If that fails and
 * no PIN was supplied, attempts a one-time migration of a legacy
 * machine-fingerprint vault: decrypt with the fingerprint, re-encrypt with
 * the current secret, and return the plaintext.
 *
 * @param options.pin - Optional custom PIN. Defaults to the per-origin secret.
 * @returns The decrypted plaintext, or `undefined` if no vault exists or
 *          decryption fails (wrong PIN, tampered data).
 */
export const decrypt = async (options: { pin?: string }): Promise<string | undefined> => {
  logger.debug('decrypt');

  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) {
    return undefined;
  }

  const pin = options.pin || getVaultSecret();
  const plaintext = await decryptWith(pin, raw);
  if (plaintext !== undefined) {
    return plaintext;
  }

  // Legacy migration — vault written before the random secret existed.
  if (!options.pin) {
    const legacy = await decryptWith(getMachineFingerprint(), raw);
    if (legacy !== undefined) {
      logger.debug('decrypt:migrated-legacy-fingerprint-vault');
      await encrypt({ text: legacy });
      return legacy;
    }
  }

  return undefined;
};

/**
 * Removes the vault from localStorage.
 */
export const clearVault = (): void => {
  logger.debug('clearVault');
  localStorage.removeItem(VAULT_KEY);
};
