// scripts/src/lib/deploy/__tests__/updater_channel.test.ts
//
// Staging and production are signed by separate keypairs and served from
// separate manifests. Both halves of that split are silent when wrong — a
// mismatched pubkey looks like "no update available", not like an error — so
// they are pinned here.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { updaterConfig } from '../tauri_release.ts';

const ROOT_DIR = resolve(import.meta.dir, '../../../../..');
const TAURI_CONF = join(ROOT_DIR, 'apps/frontend/client/src-tauri/tauri.conf.json');

const committedUpdater = (): { pubkey: string; endpoints: string[] } =>
  JSON.parse(readFileSync(TAURI_CONF, 'utf8')).plugins.updater;

describe('updater channel', () => {
  test('production polls /releases/latest, which GitHub excludes prereleases from', () => {
    const { endpoints } = updaterConfig('production');
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toContain('/releases/latest/download/latest.json');
  });

  test('staging polls the rolling staging tag, a stable URL', () => {
    const { endpoints } = updaterConfig('staging');
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toContain('/releases/download/staging/latest.json');
  });

  test('a build never polls both channels', () => {
    // Tauri tries endpoints in order and takes the first that answers, so a
    // stable install listing the staging endpoint could be pulled onto a
    // staging build.
    for (const mode of ['production', 'staging']) {
      expect(updaterConfig(mode).endpoints).toHaveLength(1);
    }
  });

  test('production inherits the committed pubkey rather than overriding it', () => {
    expect(updaterConfig('production').pubkey).toBeUndefined();
    expect(committedUpdater().pubkey).toBeTruthy();
  });

  test('staging overrides the pubkey, and it differs from production’s', () => {
    const staging = updaterConfig('staging').pubkey;
    expect(staging).toBeTruthy();
    // Same key on both channels would defeat the split entirely: a leaked
    // staging key could then sign an update production installs accept.
    expect(staging).not.toBe(committedUpdater().pubkey);
  });

  test('the staging pubkey is a well-formed minisign public key', () => {
    const decoded = Buffer.from(updaterConfig('staging').pubkey ?? '', 'base64').toString('utf8');
    expect(decoded).toContain('minisign public key');
    // comment line + key line
    expect(decoded.trim().split('\n')).toHaveLength(2);
  });
});
