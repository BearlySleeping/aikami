// apps/backend/local-stack/src/scripts/bundle.ts
//
// C-418 Feature F: builds the release bundles for the one-command installers
// (was scripts/bundle_stack.sh).
//
//   per-platform bundle layout (local-stack-<version>-<platform>):
//     compose*.yaml  .env.example  VERSION  bin/stack-init[.exe]
//     POSIX platforms:  install.sh  aikami
//     Windows:          install.ps1 aikami.ps1  aikami.cmd
//
//   artifacts:
//     dist/local-stack-<version>-<platform>.tar.gz   (linux, darwin)
//     dist/local-stack-<version>-windows-x64.zip     (windows)
//     dist/SHA256SUMS                                (covers every asset)
//
// `stack-init` is the hardware-detection wizard (src/lib/init.ts) compiled to
// a single-file Bun binary so the installer can run it on the HOST without a
// repo checkout, Node, or Bun installed. GPU detection never runs inside a
// container (no NVIDIA toolkit — C-418 Feature F).
//
// Platform (M1): ONE PLATFORM PER ASSET. A compiled Bun binary is ~95 MB
// (~38 MB compressed); shipping all five in one tarball would make every user
// download ~190 MB to run one of them. Each platform therefore gets its own
// archive containing only the binary and the installer that platform can run,
// and install.sh / install.ps1 request their own asset by name.
//
// By default only the HOST platform is built (fast local/CI iteration). The
// publish workflow sets AIKAMI_BUNDLE_TARGETS to the full matrix:
//   AIKAMI_BUNDLE_TARGETS="bun-linux-x64 bun-linux-arm64 bun-darwin-x64 \
//                          bun-darwin-arm64 bun-windows-x64"
//
// Usage: bun src/scripts/bundle.ts   (AIKAMI_STACK_VERSION overrides the tag)

// biome-ignore-all lint/suspicious/noConsole: CLI tool — console is the interface

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');

const log = (message: string): void => console.log(`\u001b[1;34m[bundle]\u001b[0m ${message}`);
const die = (message: string): never => {
  console.error(`\u001b[1;31m[bundle] error:\u001b[0m ${message}`);
  process.exit(1);
};

/** Read the version from package.json (jq-free — works on Git Bash too). */
const readVersion = (): string => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  return pkg.version ?? '0.1.0';
};

const VERSION = process.env.AIKAMI_STACK_VERSION ?? readVersion();
const DIST_DIR = process.env.AIKAMI_BUNDLE_DIR ?? 'dist';

/** Determine the host platform target (bun-<os>-<arch>). */
const hostTarget = (): string => {
  const osNames: Record<string, string> = {
    linux: 'linux',
    darwin: 'darwin',
    win32: 'windows',
  };
  const os = osNames[process.platform];
  if (os === undefined) {
    return die(`unsupported build host '${process.platform}'`);
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `bun-${os}-${arch}`;
};

const BUNDLE_TARGETS = (process.env.AIKAMI_BUNDLE_TARGETS ?? hostTarget())
  .split(/\s+/)
  .filter(Boolean);

/** Cross-compile init.ts to a single-file Bun binary for one target. */
const compileWizard = (target: string, outfile: string): void => {
  log(`compiling ${target} wizard (bun build --compile --target ${target})`);
  const res = spawnSync(
    'bun',
    ['build', '--compile', '--target', target, 'src/lib/init.ts', '--outfile', outfile],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (res.status !== 0) {
    die(`bun build failed for ${target}`);
  }
  // bun appends .exe for windows targets even when the outfile already has it;
  // normalise so the installer's expected path always exists.
  if (!existsSync(outfile) && existsSync(`${outfile}.exe`)) {
    renameSync(`${outfile}.exe`, outfile);
  }
};

/** Fall back to Python's zipfile module (host may lack `zip`). */
const makeZip = (distDir: string, name: string, topDir: string): void => {
  const out = join(distDir, name);
  rmSync(out, { force: true });
  const bundleDir = join(distDir, 'bundle');

  if (
    spawnSync('zip', ['-qr', `../${name}`, topDir], { cwd: bundleDir, stdio: 'ignore' }).status ===
      0 &&
    existsSync(out)
  ) {
    return;
  }
  for (const py of ['python3', 'python', 'py']) {
    const res = spawnSync(py, ['-m', 'zipfile', '-c', `../${name}`, topDir], {
      cwd: bundleDir,
      stdio: 'ignore',
    });
    if (res.status === 0 && existsSync(out)) {
      return;
    }
  }
  die(
    `no working archiver for ${name} — install zip or a real python3 (the Microsoft Store python alias does not count).`,
  );
};

const sha256Of = (file: string): string => {
  const buf = readFileSync(file);
  return `${createHash('sha256').update(buf).digest('hex')}  ${basename(file)}`;
};

if (import.meta.main) {
  log(`bundling local-stack ${VERSION}`);
  log(`targets: ${BUNDLE_TARGETS.join(' ')}`);
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(join(DIST_DIR, 'bundle'), { recursive: true });

  for (const target of BUNDLE_TARGETS) {
    const platform = target.replace('bun-', '');
    const bundleDir = join(DIST_DIR, 'bundle', `local-stack-${VERSION}-${platform}`);
    mkdirSync(join(bundleDir, 'bin'), { recursive: true });

    const binary = platform.startsWith('windows-')
      ? join(bundleDir, 'bin', 'stack-init.exe')
      : join(bundleDir, 'bin', 'stack-init');
    compileWizard(target, binary);

    log('  copying compose topology + env example + installer');
    // Compose files live under compose/ in the repo (src layout) but are laid
    // FLAT in the released bundle — install.sh, aikami and docker compose
    // expect compose*.yaml at the bundle root. So read from compose/ here and
    // write each file to the bundle root.
    const composeDir = join(ROOT, 'compose');
    for (const file of await readdir(composeDir)) {
      if (file.startsWith('compose') && file.endsWith('.yaml')) {
        await cp(join(composeDir, file), join(bundleDir, file));
      }
    }
    await cp(join(ROOT, '.env.example'), join(bundleDir, '.env.example'));
    await writeFile(join(bundleDir, 'VERSION'), VERSION);

    if (platform.startsWith('windows-')) {
      await cp(join(ROOT, 'install.ps1'), join(bundleDir, 'install.ps1'));
      await cp(join(ROOT, 'aikami.ps1'), join(bundleDir, 'aikami.ps1'));
      await cp(join(ROOT, 'aikami.cmd'), join(bundleDir, 'aikami.cmd'));
      const archive = `local-stack-${VERSION}-${platform}.zip`;
      log(`  creating ${join(DIST_DIR, archive)}`);
      makeZip(DIST_DIR, archive, `local-stack-${VERSION}-${platform}`);
    } else {
      await cp(join(ROOT, 'install.sh'), join(bundleDir, 'install.sh'));
      await cp(join(ROOT, 'aikami'), join(bundleDir, 'aikami'));
      chmodSync(join(bundleDir, 'aikami'), 0o755);
      chmodSync(join(bundleDir, 'install.sh'), 0o755);
      const archive = `local-stack-${VERSION}-${platform}.tar.gz`;
      log(`  creating ${join(DIST_DIR, archive)}`);
      const res = spawnSync(
        'tar',
        [
          '-czf',
          join(DIST_DIR, archive),
          '-C',
          join(DIST_DIR, 'bundle'),
          `local-stack-${VERSION}-${platform}`,
        ],
        { cwd: ROOT, stdio: 'inherit' },
      );
      if (res.status !== 0) {
        die(`tar failed for ${archive}`);
      }
    }
  }

  // M2: checksums so the installers can verify every archive before extraction.
  log(`writing ${join(DIST_DIR, 'SHA256SUMS')}`);
  const sums: string[] = [];
  for (const file of await readdir(DIST_DIR)) {
    if (/^local-stack-.*\.(tar\.gz|zip)$/.test(file)) {
      sums.push(sha256Of(join(DIST_DIR, file)));
    }
  }
  await writeFile(join(DIST_DIR, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  if (sums.length === 0) {
    die('no assets were produced.');
  }

  log('done');
  console.log((await readdir(DIST_DIR)).map((f) => `  ${f}`).join('\n'));
  console.log((await readFile(join(DIST_DIR, 'SHA256SUMS'), 'utf8')).trim());
}
