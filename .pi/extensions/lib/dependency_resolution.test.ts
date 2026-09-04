// Regression test for the missing-module failure at f73e5fae: importing
// anything from '@earendil-works/pi-coding-agent' re-exports `main` from
// dist/main.js, which statically imports dist/experimental/server.js, which
// in turn imports '@earendil-works/pi-server' and '@earendil-works/pi-server/unix'.
// Upstream 0.85.0 does not declare '@earendil-works/pi-server' as a
// dependency, so a clean install leaves it unresolved and every extension
// import throws "Cannot find module '@earendil-works/pi-server'".
//
// .pi/package.json pins '@earendil-works/pi-server' directly so the lockfile
// installs it. This test fails loudly if that pin is ever dropped.

import { describe, expect, test } from 'bun:test';

describe('pi-coding-agent dependency graph', () => {
  test('the package root import resolves without a missing-module error', async () => {
    // index.js does `export { main } from "./main.js"`, a re-export binding
    // that forces evaluation of main.js — including its static import of
    // experimental/server.js — even though this test never touches `main`.
    const mod = await import('@earendil-works/pi-coding-agent');
    expect(mod.main).toBeDefined();
  });
});
