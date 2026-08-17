// scripts/src/lib/chromium.ts
//
// Chromium/Chrome executable discovery, shared by the preview scripts
// (client, site, hub). Resolves a real, directly-spawnable browser path.
//
// Bare command names that work via shell PATH search on Linux/mac are not
// reliably spawnable via Bun.spawn/CreateProcess on native Windows (no
// implicit PATHEXT-style shell resolution, and user PATH entries can point
// at incomplete/broken browser copies — see the 2026-08-18 Windows
// preview-client incident, where `which chromium` matched a bare launcher
// stub copied without its adjacent chrome.dll/resources).

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_POSIX_CANDIDATES = ['chromium', 'chromium-unwrapped', 'chromium-browser', 'google-chrome'];

/**
 * Look for a real browser install directly rather than trusting PATH —
 * covers standard Chrome/Edge installs plus a Playwright-managed Chromium
 * cache (e.g. `bunx playwright install chromium`).
 */
const findChromiumExecutableWindows = (): string | null => {
  const programDirs = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env['LOCALAPPDATA'],
  ].filter((p): p is string => Boolean(p));

  const relPaths = [
    'Google/Chrome/Application/chrome.exe',
    'Microsoft/Edge/Application/msedge.exe',
    'Chromium/Application/chrome.exe',
  ];
  for (const base of programDirs) {
    for (const rel of relPaths) {
      const full = resolve(base, rel);
      if (existsSync(full)) {
        return full;
      }
    }
  }

  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) {
    const playwrightDir = resolve(localAppData, 'ms-playwright');
    try {
      const entries = readdirSync(playwrightDir).filter((d) => d.startsWith('chromium-'));
      for (const entry of entries) {
        const exe = resolve(playwrightDir, entry, 'chrome-win64', 'chrome.exe');
        if (existsSync(exe)) {
          return exe;
        }
      }
    } catch {}
  }

  return null;
};

/**
 * Resolve a Chromium/Chrome executable to launch.
 *
 * Order: CHROMIUM_EXECUTABLE / CHROME_EXECUTABLE env var, then a
 * platform-appropriate lookup. `posixCandidates` lets callers prioritize a
 * platform-specific bare name (e.g. `chromium-unwrapped` to bypass a
 * flake.nix wrapper) on Linux/mac; it's unused on win32.
 */
export const findChromiumExecutable = (
  posixCandidates: string[] = DEFAULT_POSIX_CANDIDATES,
): string | null => {
  const envPath = process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_EXECUTABLE;
  if (envPath) {
    return envPath;
  }

  if (process.platform === 'win32') {
    return findChromiumExecutableWindows();
  }

  for (const bin of posixCandidates) {
    try {
      const result = Bun.spawnSync(['which', bin], { stdout: 'pipe', stderr: 'ignore' });
      if (result.exitCode === 0) {
        const path = result.stdout.toString().trim();
        if (path) {
          return path;
        }
      }
    } catch {}
  }

  return null;
};
