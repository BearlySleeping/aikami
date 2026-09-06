// packages/shared/types/src/lib/storage_seam.ts
//
// Typed storage/restore interface for encrypted AI configuration (C-481).
// The seam is frozen in Phase 1; implementations live in the client.
//
// A genuinely absent vault (first-time setup) is distinguishable from a
// wrong PIN, corrupt data, or an unknown version. Reads never rewrite
// storage. Writes take a pre-upgrade snapshot, write atomically, and
// expose crash/retry semantics.
//
// Contract: C-481

import type { ConfigError } from './config_errors.ts';

// ---------------------------------------------------------------------------
// Vault status — what the vault looks like before reading
// ---------------------------------------------------------------------------

/** The state of the encrypted vault before an attempted read. */
export type VaultStatus =
  /** No vault exists at all — first-time setup. */
  | { kind: 'absent' }
  /** Vault exists and can be read with the correct PIN. */
  | { kind: 'present' }
  /** Vault exists but is corrupted. */
  | { kind: 'corrupt'; detail?: string }
  /** Vault exists but is in an unknown version. */
  | { kind: 'unsupported_version'; version?: number };

// ---------------------------------------------------------------------------
// Vault unlock result
// ---------------------------------------------------------------------------

/** Result of a vault unlock attempt. */
export type VaultUnlockResult =
  /** Successfully unlocked. */
  | { kind: 'unlocked'; data: string }
  /** Wrong PIN. */
  | { kind: 'wrong_pin' }
  /** Vault is corrupt. */
  | { kind: 'corrupt'; detail?: string }
  /** Vault is in an unknown version. */
  | { kind: 'unsupported_version'; version?: number }
  /** Read failed for another reason. */
  | { kind: 'error'; error: ConfigError };

// ---------------------------------------------------------------------------
// Write result
// ---------------------------------------------------------------------------

/** Result of a vault write operation. */
export type VaultWriteResult =
  /** Successfully written. */
  | { kind: 'written' }
  /** Write failed — storage full or quota exceeded. */
  | { kind: 'storage_failed'; detail?: string }
  /** Conflict — a newer revision exists. */
  | { kind: 'conflict' }
  /** Write failed for another reason. */
  | { kind: 'error'; error: ConfigError };

// ---------------------------------------------------------------------------
// Vault adapter interface
// ---------------------------------------------------------------------------

/**
 * Typed storage/restore interface for encrypted AI configuration.
 *
 * The seam is frozen here. Implementations (vault crypto, IndexedDB, etc.)
 * must satisfy this contract exactly.
 *
 * Properties:
 * - read/decrypt never rewrite storage.
 * - A genuinely absent vault (no data at all) is distinguishable from a
 *   wrong PIN, corrupt data, or an unknown version.
 * - Writes take a pre-upgrade snapshot, write atomically (or equivalently
 *   recoverably), and expose crash/retry semantics.
 * - Failure retains the last committed state and any recoverable draft.
 */
export interface VaultAdapter {
  /** Check vault status without reading its contents. */
  checkStatus(): Promise<VaultStatus>;

  /** Unlock the vault with the given PIN and return the raw data. */
  unlock(pin?: string): Promise<VaultUnlockResult>;

  /**
   * Write new vault data. Takes a pre-upgrade snapshot before writing.
   * Returns a conflict when another instance wrote a newer revision.
   */
  write(options: {
    data: string;
    pin?: string;
    /** Current revision token, for conflict detection. */
    expectedRevision?: string;
  }): Promise<VaultWriteResult>;

  /**
   * Restore the pre-upgrade snapshot. Only valid after a failed migration.
   * The caller must confirm that later changes will be lost.
   */
  restoreSnapshot(): Promise<VaultWriteResult>;

  /** Clear all vault data. For reset/wipe operations. */
  clear(): Promise<void>;
}
