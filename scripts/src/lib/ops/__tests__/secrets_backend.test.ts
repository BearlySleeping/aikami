// scripts/src/lib/ops/__tests__/secrets_backend.test.ts
//
// Tests for the SOPS secrets backend (C-441).
// Covers backend selection, key availability detection, and encrypted-file
// detection. Full round-trip tests (decrypt → hash-compare) require actual
// encrypted secrets/*.enc.env files that are generated manually from GSM.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Module under test ───────────────────────────────────────────────────

const {
  resolveBackend,
  sopsKeyAvailable,
  isSopsEncrypted,
} = await import("../secrets_backend.ts");

// ── Helpers ─────────────────────────────────────────────────────────────

let _tmpDir: string;

function tmpPath(name: string): string {
  return join(_tmpDir, name);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("secrets_backend", () => {
  describe("resolveBackend", () => {
    const _origEnv = process.env.AIKAMI_SECRETS_BACKEND;

    beforeEach(() => {
      delete process.env.AIKAMI_SECRETS_BACKEND;
    });

    afterEach(() => {
      if (_origEnv !== undefined) {
        process.env.AIKAMI_SECRETS_BACKEND = _origEnv;
      } else {
        delete process.env.AIKAMI_SECRETS_BACKEND;
      }
    });

    it("defaults to 'gsm' when env var is not set", () => {
      expect(resolveBackend()).toBe("gsm");
    });

    it("returns 'sops' when env var is set to 'sops'", () => {
      process.env.AIKAMI_SECRETS_BACKEND = "sops";
      expect(resolveBackend()).toBe("sops");
    });

    it("returns 'gsm' when env var is set to 'gsm'", () => {
      process.env.AIKAMI_SECRETS_BACKEND = "gsm";
      expect(resolveBackend()).toBe("gsm");
    });

    it("is case-insensitive", () => {
      process.env.AIKAMI_SECRETS_BACKEND = "SOPS";
      expect(resolveBackend()).toBe("sops");
    });
  });

  describe("sopsKeyAvailable", () => {
    const _origSopsKey = process.env.SOPS_AGE_KEY;
    const _origHome = process.env.HOME;

    afterEach(() => {
      if (_origSopsKey !== undefined) {
        process.env.SOPS_AGE_KEY = _origSopsKey;
      } else {
        delete process.env.SOPS_AGE_KEY;
      }
      process.env.HOME = _origHome;
    });

    it("returns true when SOPS_AGE_KEY env var is set", () => {
      process.env.SOPS_AGE_KEY = "AGE-SECRET-KEY-1ABC...";
      expect(sopsKeyAvailable()).toBe(true);
    });

    it("returns false when no env var and no key file exists", () => {
      delete process.env.SOPS_AGE_KEY;
      process.env.HOME = "/nonexistent";
      expect(sopsKeyAvailable()).toBe(false);
    });
  });

  describe("isSopsEncrypted", () => {
    beforeEach(() => {
      _tmpDir = join(tmpdir(), "sops-test-" + Math.random().toString(36).slice(2));
      mkdirSync(_tmpDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(_tmpDir, { recursive: true, force: true });
    });

    it("returns false for a non-existent file", () => {
      expect(isSopsEncrypted(tmpPath("nope"))).toBe(false);
    });

    it("returns false for a plaintext env file", () => {
      const f = tmpPath("plain.env");
      writeFileSync(f, "FOO=bar\nBAZ=qux\n");
      expect(isSopsEncrypted(f)).toBe(false);
    });

    it("returns true for a file starting with ENC[", () => {
      const f = tmpPath("encrypted.enc.env");
      writeFileSync(f, 'ENC[AES256_GCM,data:abc123,iv:...,tag:...,type:str]\n');
      expect(isSopsEncrypted(f)).toBe(true);
    });

    it("returns true for a file containing 'sops' marker", () => {
      const f = tmpPath("sops_marker.enc.env");
      writeFileSync(f, "# sops_version=3.9.0\nFOO=bar\n");
      expect(isSopsEncrypted(f)).toBe(true);
    });
  });
});
