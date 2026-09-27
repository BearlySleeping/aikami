// apps/e2e/src/services/capture_evidence_identity.test.ts

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyLoadedContentIdentity } from '../../scripts/capture_evidence.ts';

describe('evidence loaded-content identity', () => {
  test('allows absent before identity but requires the candidate digest after capture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evidence-identity-'));
    try {
      const manifest = { id: 'emberwatch', name: 'Emberwatch', version: '1', updatedAt: 'today' };
      const canonical = '{"id":"emberwatch","name":"Emberwatch","updatedAt":"today","version":"1"}';
      const digest = createHash('sha256').update(canonical).digest('hex');
      const directory = join(root, 'content/packs/emberwatch');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
      const snapshot = {
        packId: 'emberwatch',
        packName: 'Emberwatch',
        version: '1',
        updatedAt: 'today',
        manifestSha256: digest,
        propAtlases: [],
        provenanceSource: 'unknown',
      };

      expect(await verifyLoadedContentIdentity(undefined, 'before', root)).toBeUndefined();
      await expect(verifyLoadedContentIdentity(undefined, 'after', root)).rejects.toThrow(
        /not published/,
      );
      await expect(
        verifyLoadedContentIdentity({ ...snapshot, manifestSha256: '0'.repeat(64) }, 'after', root),
      ).rejects.toThrow(/does not match candidate manifest/);
      expect(await verifyLoadedContentIdentity(snapshot, 'after', root)).toEqual(snapshot);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
