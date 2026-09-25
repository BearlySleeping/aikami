// packages/frontend/engine/src/assets/content_identity.ts

import type { ContentIdentitySnapshot } from '@aikami/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Content identity manifest is missing required fields: ${key}`);
  }
  return value;
};

const optionalString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readPropAtlases = (
  manifest: Record<string, unknown>,
): ContentIdentitySnapshot['propAtlases'] => {
  const value = manifest.propAtlases;
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Content identity manifest is missing required fields: propAtlases');
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Content identity prop atlas ${index} is invalid`);
    }
    return {
      textureUrl: requiredString(entry, 'textureUrl'),
      spritesheetUrl: requiredString(entry, 'spritesheetUrl'),
    };
  });
};

/**
 * Resolves the identity of the exact validated manifest consumed by the client.
 * The digest is SHA-256 over recursively key-sorted JSON; array order remains
 * significant because authored arrays can carry semantic ordering.
 */
export const resolveContentIdentity = async (
  manifest: unknown,
  packId: string,
): Promise<ContentIdentitySnapshot> => {
  if (!isRecord(manifest)) {
    throw new Error('Content identity manifest is missing required fields: root');
  }
  const manifestId = requiredString(manifest, 'id');
  if (manifestId !== packId) {
    throw new Error(`Content identity pack mismatch: requested ${packId}, loaded ${manifestId}`);
  }
  const atlasValue = isRecord(manifest.atlas) ? manifest.atlas : undefined;
  const provenanceValue = atlasValue?.provenance;
  const provenanceSource = isRecord(provenanceValue)
    ? optionalString(provenanceValue, 'source')
    : undefined;
  const atlasTextureUrl = atlasValue ? optionalString(atlasValue, 'textureUrl') : undefined;
  const atlasSpritesheetUrl = atlasValue ? optionalString(atlasValue, 'spritesheetUrl') : undefined;
  const canonicalManifest = JSON.stringify(canonicalize(manifest));
  if (canonicalManifest === undefined) {
    throw new Error('Content identity manifest is not serializable');
  }

  return {
    packId,
    packName: requiredString(manifest, 'name'),
    version: requiredString(manifest, 'version'),
    updatedAt: requiredString(manifest, 'updatedAt'),
    manifestSha256: await sha256Hex(canonicalManifest),
    ...(atlasTextureUrl === undefined ? {} : { atlasTextureUrl }),
    ...(atlasSpritesheetUrl === undefined ? {} : { atlasSpritesheetUrl }),
    propAtlases: readPropAtlases(manifest),
    provenanceSource: provenanceSource ?? 'unknown',
  };
};
