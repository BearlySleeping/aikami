// apps/frontend/client/src/lib/services/game/game_save_envelope.ts

import type { ServiceSnapshot } from './serializable_service';

/** Map-routing block persisted in save envelopes version 3 and later. */
export type SaveMapBlock = {
  /** Content pack identifier. */
  packId: string;
  /** Map identifier within the content pack. */
  mapId: string;
  /** Player X pixel coordinate on the saved map. */
  playerX: number;
  /** Player Y pixel coordinate on the saved map. */
  playerY: number;
  /** Optional spawn identifier used to enter the map. */
  spawnId?: string;
  /**
   * Pack version when the save was created (v4+).
   * Missing = treat as the currently installed version (v3 compatibility).
   * Contract: C-381 AC-3.
   */
  packVersion?: string;
  /**
   * Seed for reproducible world generation (v4+).
   * Missing = derived deterministically from campaign id (v3 compatibility).
   * Contract: C-381 AC-4 / AC-9.
   */
  worldSeed?: string;
};

/** Parsed representation of a persisted save payload. */
export type ParsedSavePayloadEnvelope = {
  ecsSnapshot: string;
  serviceSnapshots?: ServiceSnapshot[];
  /** Envelope version, or undefined for pre-v2 payloads. */
  version?: number;
  /** Whether the checksum is already known to be valid. */
  checksumValid: boolean;
  /** Raw stored checksum, when present. */
  storedChecksum?: string;
  /** Map-routing block present in v3 and later payloads. */
  map?: SaveMapBlock;
};

/** Computes a SHA-256 hexadecimal digest for corruption detection. */
export const sha256 = async (input: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Parses versioned save envelopes and legacy plain ECS snapshots.
 *
 * @param raw - Raw payload read from persistent storage.
 * @returns Parsed snapshots, checksum metadata, and optional map routing data.
 */
export const parseSavePayloadEnvelope = (raw: string): ParsedSavePayloadEnvelope => {
  try {
    const envelope = JSON.parse(raw) as {
      ecsSnapshot: string;
      serviceSnapshots?: ServiceSnapshot[];
      version?: number;
      checksum?: string;
      map?: SaveMapBlock;
    };
    if (!envelope.ecsSnapshot) {
      throw new Error('Missing ecsSnapshot');
    }

    const version = envelope.version;
    if (!version || version < 2 || !envelope.checksum) {
      return {
        ecsSnapshot: envelope.ecsSnapshot,
        serviceSnapshots: envelope.serviceSnapshots,
        version,
        checksumValid: true,
        storedChecksum: envelope.checksum,
        map: envelope.map,
      };
    }

    return {
      ecsSnapshot: envelope.ecsSnapshot,
      serviceSnapshots: envelope.serviceSnapshots,
      version,
      checksumValid: false,
      storedChecksum: envelope.checksum,
      map: envelope.map,
    };
  } catch {
    return { ecsSnapshot: raw, version: undefined, checksumValid: true };
  }
};

/**
 * Validates a versioned save envelope's checksum.
 *
 * @param options - Persisted envelope fields used to reconstruct the digest.
 * @returns Whether the reconstructed digest matches the stored checksum.
 */
export const validateEnvelopeChecksum = async (options: {
  ecsSnapshot: string;
  serviceSnapshots?: ServiceSnapshot[];
  map?: SaveMapBlock;
  storedChecksum: string;
  version?: number;
}): Promise<boolean> => {
  try {
    const version = options.version ?? 2;
    const dataToHash =
      version >= 4
        ? JSON.stringify({
            ecsSnapshot: options.ecsSnapshot,
            serviceSnapshots: options.serviceSnapshots,
            map: options.map,
            packVersion: options.map?.packVersion,
            worldSeed: options.map?.worldSeed,
          })
        : version >= 3
          ? JSON.stringify({
              ecsSnapshot: options.ecsSnapshot,
              serviceSnapshots: options.serviceSnapshots,
              map: options.map,
            })
          : JSON.stringify({
              ecsSnapshot: options.ecsSnapshot,
              serviceSnapshots: options.serviceSnapshots,
            });
    const computed = await sha256(dataToHash);
    return computed === options.storedChecksum;
  } catch {
    return false;
  }
};
