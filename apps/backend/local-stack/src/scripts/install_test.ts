// apps/backend/local-stack/src/scripts/install_test.ts
//
// Self-test for the POSIX one-command installer (C-418 Feature F AC-6
// integration hook). Exercises the installer against a LOCAL bundle served
// over HTTP — no network, no real hardware wizard (a fake `stack-init` writes
// the .env). When Docker is available it ALSO proves the wizard-written .env
// is actually read by `docker compose config` in the compose project dir (H2).
// Run via:  bun moon run local-stack:test-install
//
// Was scripts/install.test.sh; the Windows twin logic is replaced by the
// same harness driving install.ps1 where PowerShell is available.
//
// Asserts:
//   1. install.sh is valid POSIX sh (sh -n).
//   2. Platform detection runs and accepts the host platform.
//   3. The installer downloads + checksum-verifies + extracts + runs wizard;
//      the wizard .env lands in the compose project dir (<dir>/current/.env).
//   4. The `aikami` control command is installed and resolves the project dir.
//   5. An existing .env is never overwritten.
//   6. AIKAMI_SKIP_WIZARD=1 skips the wizard (fetch-only).
//   7. A tampered tarball (checksum mismatch) is rejected before extraction.
//   8. The bundle script produces per-platform archives + SHA256SUMS.
//   9. (docker available) docker compose config in the project dir honors the
//      wizard-written COMPOSE_PROFILES.
//  10. Cancelled wizard (exit 0, no .env) — installer exits gracefully without
//      continuing to startup prompts.

// biome-ignore-all lint/suspicious/noConsole: test harness — console is the interface
// biome-ignore-all lint/style/useNamingConvention: env-var keys are uppercase by definition

import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const ROOT = join(import.meta.dir, '../..');

const log = (message: string): void =>
  console.log(`\u001b[1;34m[install.test]\u001b[0m ${message}`);
const fail = (message: string): never => {
  console.error(`\u001b[1;31m[install.test] FAIL:\u001b[0m ${message}`);
  process.exit(1);
};
const skip = (message: string): void => {
  console.log(`\u001b[1;33m[install.test] SKIP:\u001b[0m ${message}`);
};

const execFileAsync = promisify(execFile);

/** Run a program asynchronously so the HTTP server's event loop stays alive. */
const run = async (
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number } = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> => {
  try {
    const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
    // Keys explicitly set to `undefined` in opts.env must be REMOVED from the
    // merged env (docker/podman treats an unset COMPOSE_FILE/COMPOSE_PROFILES
    // as "use defaults from the project dir"). Because we re-spread
    // `...process.env` first, deleted keys on opts.env would otherwise leak
    // back in — so honour `undefined` here.
    for (const key of Object.keys(opts.env ?? {})) {
      if (opts.env?.[key] === undefined) {
        delete mergedEnv[key as string];
      }
    }
    const { stdout, stderr } = await execFileAsync(cmd, args as string[], {
      cwd: opts.cwd ?? ROOT,
      env: mergedEnv,
      encoding: 'utf8',
      timeout: opts.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, stdout: (stdout ?? '') as string, stderr: (stderr ?? '') as string };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return {
      status: e.code ?? 1,
      stdout: (e.stdout ?? '') as string,
      stderr: (e.stderr ?? '') as string,
    };
  }
};

// ── Platform ────────────────────────────────────────────────────────────
function resolvePlatform(): 'linux' | 'darwin' | 'windows' {
  switch (process.platform) {
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'darwin';
    case 'win32':
      return 'windows';
    default:
      fail(`unsupported test host ${process.platform}`);
      return 'linux'; // unreachable (fail exits)
  }
}
const platform = resolvePlatform();
if (platform === 'windows') {
  skip('Windows host — this harness drives the POSIX installer; see install.ps1');
  process.exit(0);
}
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const PLATFORM = `${platform}-${arch}`;
const ASSET = `local-stack-test-${PLATFORM}.tar.gz`;
log(`host platform: ${PLATFORM} (asset ${ASSET})`);

// ── Syntax check ────────────────────────────────────────────────────────
log('syntax check (sh -n)');
if ((await run('sh', ['-n', 'install.sh'])).status !== 0) {
  fail('install.sh is not valid POSIX sh');
}
if ((await run('sh', ['-n', 'aikami'])).status !== 0) {
  fail('aikami control script is not valid POSIX sh');
}

const TMP = await mkdtemp(join(tmpdir(), 'aikami-install-test-'));
let httpServer: Server | undefined;
const cleanup = async (): Promise<void> => {
  if (httpServer) {
    await new Promise<void>((resolveClose) => httpServer?.close(() => resolveClose()));
  }
  await rm(TMP, { recursive: true, force: true });
};

try {
  // ── 3. Build a fake bundle (real-enough compose files for the docker check)
  const BUNDLE_DIR = join(TMP, 'bundle', `local-stack-test-${PLATFORM}`);
  mkdirSync(join(BUNDLE_DIR, 'bin'), { recursive: true });

  const fakeWizard = `#!/bin/sh\n# Fake hardware wizard: writes .env the way the real one would.\nenv_path=\nfor arg in "$@"; do\n  if [ "$prev" = "--env-path" ]; then\n    env_path="$arg"\n  fi\n  prev="$arg"\ndone\n[ -n "$env_path" ] || { echo "fake-stack-init: missing --env-path" >&2; exit 2; }\nprintf 'COMPOSE_PROFILES=text,image,voice\\nCOMPOSE_FILE=compose.yaml:compose.cpu.yaml\\n' > "$env_path"\necho "fake-stack-init: wrote $env_path"\n`;
  writeFileSync(join(BUNDLE_DIR, 'bin', 'stack-init'), fakeWizard);
  chmodSync(join(BUNDLE_DIR, 'bin', 'stack-init'), 0o755);
  writeFileSync(join(BUNDLE_DIR, '.env.example'), 'COMPOSE_PROFILES=text,image,voice\n');

  const fakeCompose = `services:\n  text-engine:\n    image: busybox\n    profiles: ["text"]\n`;
  writeFileSync(join(BUNDLE_DIR, 'compose.yaml'), fakeCompose);
  writeFileSync(join(BUNDLE_DIR, 'compose.cpu.yaml'), '');
  const aikami = readFileSync(join(ROOT, 'aikami'), 'utf8');
  writeFileSync(join(BUNDLE_DIR, 'aikami'), aikami);
  chmodSync(join(BUNDLE_DIR, 'aikami'), 0o755);

  // ── 4. Create the tarball + SHA256SUMS + serve over HTTP
  const tarball = join(TMP, ASSET);
  tarCzf(tarball, TMP, 'bundle', `local-stack-test-${PLATFORM}`);
  const serveRoot = join(TMP, 'local-stack-test');
  mkdirSync(serveRoot, { recursive: true });
  writeFileSync(join(serveRoot, ASSET), readFileSync(tarball));
  const sums = sha256Of(join(serveRoot, ASSET));
  writeFileSync(join(serveRoot, 'SHA256SUMS'), sums);

  const PORT = 20000 + Math.floor(Math.random() * 20000);
  // Serve from $TMP so /local-stack-test/<asset> and /local-stack-test/SHA256SUMS
  // resolve to the fixture files (mirrors the GitHub releases download path:
  // <base>/<tag>/<asset>).
  const serverRoot = TMP;
  httpServer = createServer((req, res) => {
    const file = join(serverRoot, decodeURIComponent(req.url ?? '/').replace(/^\//, ''));
    if (!file.startsWith(serverRoot) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(readFileSync(file));
  });
  await new Promise<void>((resolveListen) => httpServer?.listen(PORT, '127.0.0.1', resolveListen));

  const BASE_URL = `http://127.0.0.1:${PORT}`;
  const INSTALL_DIR = join(TMP, 'install-root');
  const env: Record<string, string> = {
    AIKAMI_INSTALL_BASE_URL: BASE_URL,
    AIKAMI_STACK_VERSION: 'test',
    AIKAMI_STACK_DIR: INSTALL_DIR,
    AIKAMI_YES: '1',
    AIKAMI_NO_PATH: '1',
  };

  // ── 5. First install — wizard runs, .env written INTO the compose project dir
  log('first install (wizard → .env in project dir)');
  const first = await run('sh', ['install.sh'], { env });
  if (first.status !== 0) {
    fail(`installer exited non-zero on first run: ${first.stderr}`);
  }
  if (!first.stdout.includes('checksum OK')) {
    fail('installer did not verify the checksum');
  }
  if (!first.stdout.includes('step 6/6')) {
    fail('installer did not complete all steps');
  }
  const PROJECT_DIR = join(INSTALL_DIR, 'current');
  if (!existsSync(join(PROJECT_DIR, '.env'))) {
    fail(`wizard .env was not written into the compose project dir (${join(PROJECT_DIR, '.env')})`);
  }
  if (
    !readFileSync(join(PROJECT_DIR, '.env'), 'utf8').includes('COMPOSE_PROFILES=text,image,voice')
  ) {
    fail('.env content wrong');
  }
  if (!existsSync(join(PROJECT_DIR, 'VERSION'))) {
    fail('VERSION marker missing from the project dir');
  }

  // ── 6. The `aikami` control command
  log('aikami control command');
  if (!existsSync(join(INSTALL_DIR, 'aikami'))) {
    fail(`aikami control command was not installed at ${join(INSTALL_DIR, 'aikami')}`);
  }
  const dirRes = await run(join(INSTALL_DIR, 'aikami'), ['dir']);
  if (dirRes.status !== 0 || dirRes.stdout.trim() !== PROJECT_DIR) {
    fail(`aikami dir resolved '${dirRes.stdout.trim()}', expected '${PROJECT_DIR}'`);
  }
  if (!(await run(join(INSTALL_DIR, 'aikami'), ['version'])).stdout.includes('test')) {
    fail('aikami version did not report the installed version');
  }

  // ── 7. docker compose actually reads the wizard-written .env (H2)
  log('compose reads wizard .env');
  if (spawnSync('docker', ['--version']).status === 0) {
    // The point of this check is to prove `docker compose` honors the
    // wizard-written .env's COMPOSE_PROFILES/COMPOSE_FILE. That only works if
    // ambient COMPOSE_* vars (which take precedence over the project .env in
    // docker/podman compose) are cleared first — otherwise a developer shell
    // (e.g. the emulator env) leaks its own COMPOSE_FILE and this check reads
    // the wrong topology.
    const composeEnv: Record<string, string | undefined> = { ...process.env };
    // Set to `undefined` (not `delete`) so run() honours them and drops the
    // keys from the merged env — see run()'s env handling above.
    composeEnv.COMPOSE_FILE = undefined;
    composeEnv.COMPOSE_PROFILES = undefined;
    const dc = await run('docker', ['compose', 'config'], {
      cwd: PROJECT_DIR,
      env: composeEnv,
    });
    if (!dc.stdout.includes('text-engine')) {
      fail(
        `docker compose config did not honor COMPOSE_PROFILES from the wizard .env: ${dc.stderr}`,
      );
    }
    log('  docker compose config honored COMPOSE_PROFILES=text from .env');
  } else {
    skip('docker not installed — compose-reads-.env check skipped (CI runs it)');
  }

  // ── 8. Second install — .env must NOT be overwritten
  log('second install (.env protection)');
  writeFileSync(join(PROJECT_DIR, '.env'), 'COMPOSE_PROFILES=my-custom-value\n');
  if ((await run('sh', ['install.sh'], { env })).status !== 0) {
    fail('installer exited non-zero on second run');
  }
  if (
    !readFileSync(join(PROJECT_DIR, '.env'), 'utf8').includes('COMPOSE_PROFILES=my-custom-value')
  ) {
    fail('existing .env was overwritten');
  }

  // ── 9. Skip-wizard mode
  log('skip-wizard mode');
  const INSTALL_DIR2 = join(TMP, 'install-root2');
  const skipEnv = { ...env, AIKAMI_STACK_DIR: INSTALL_DIR2, AIKAMI_SKIP_WIZARD: '1' };
  if ((await run('sh', ['install.sh'], { env: skipEnv })).status !== 0) {
    fail('installer exited non-zero with AIKAMI_SKIP_WIZARD=1');
  }
  if (existsSync(join(INSTALL_DIR2, 'current', '.env'))) {
    fail('.env should not be written in skip-wizard mode');
  }

  // ── 10. Tampered tarball must be rejected before extraction (M2)
  log('checksum rejection (tampered tarball)');
  const INSTALL_DIR3 = join(TMP, 'install-root3');
  const tamperEnv = { ...env, AIKAMI_STACK_DIR: INSTALL_DIR3 };
  writeFileSync(join(serveRoot, ASSET), 'COMPOSE_PROFILES=text,image,voice\n');
  if ((await run('sh', ['install.sh'], { env: tamperEnv })).status === 0) {
    fail('installer accepted a tampered tarball (checksum mismatch must abort)');
  }
  if (existsSync(join(INSTALL_DIR3, 'current'))) {
    fail('tampered tarball was extracted before checksum verification');
  }
  log('  tampered tarball rejected, nothing extracted');
  // restore the good tarball
  tarCzf(tarball, TMP, 'bundle', `local-stack-test-${PLATFORM}`);
  writeFileSync(join(serveRoot, ASSET), readFileSync(tarball));
  writeFileSync(join(serveRoot, 'SHA256SUMS'), sha256Of(join(serveRoot, ASSET)));

  // ── 11. Bundle script layout + SHA256SUMS (M2/H3 naming)
  log('bundle script layout');
  const bundleRes = await run('bun', ['src/scripts/bundle.ts'], {
    env: { AIKAMI_BUNDLE_DIR: join(TMP, 'dist'), AIKAMI_STACK_VERSION: 'test' },
  });
  if (bundleRes.status !== 0) {
    fail(`bundle.ts failed: ${bundleRes.stderr}`);
  }
  const BUNDLED_ASSET = join(TMP, 'dist', `local-stack-test-${PLATFORM}.tar.gz`);
  if (!existsSync(BUNDLED_ASSET)) {
    fail(`bundle tarball missing (${BUNDLED_ASSET})`);
  }
  if (!existsSync(join(TMP, 'dist', 'SHA256SUMS'))) {
    fail('SHA256SUMS missing');
  }
  if (
    !readFileSync(join(TMP, 'dist', 'SHA256SUMS'), 'utf8').includes(
      `local-stack-test-${PLATFORM}.tar.gz`,
    )
  ) {
    fail('SHA256SUMS does not reference the tarball');
  }
  for (const entry of ['bin/stack-init', 'compose.yaml', 'install.sh', 'aikami', 'VERSION']) {
    if (!tarList(BUNDLED_ASSET).includes(`local-stack-test-${PLATFORM}/${entry}`)) {
      fail(`bundle tarball missing ${entry}`);
    }
  }

  // ── 12. Cancelled wizard — installer exits gracefully
  log('cancelled wizard (exit 0, no .env)');
  const INSTALL_DIR4 = join(TMP, 'install-root4');
  const cancelEnv = { ...env, AIKAMI_STACK_DIR: INSTALL_DIR4 };
  const cancelWizard = `#!/bin/sh\n# Simulates a successful cancellation: exit 0, no .env created.\necho "fake-stack-init: user cancelled (simulated)"\nexit 0\n`;
  writeFileSync(join(BUNDLE_DIR, 'bin', 'stack-init'), cancelWizard);
  chmodSync(join(BUNDLE_DIR, 'bin', 'stack-init'), 0o755);
  tarCzf(tarball, TMP, 'bundle', `local-stack-test-${PLATFORM}`);
  writeFileSync(join(serveRoot, ASSET), readFileSync(tarball));
  writeFileSync(join(serveRoot, 'SHA256SUMS'), sha256Of(join(serveRoot, ASSET)));
  const cancelRes = await run('sh', ['install.sh'], { env: cancelEnv });
  if (cancelRes.status !== 0) {
    fail('installer exited non-zero on cancelled wizard');
  }
  if (!cancelRes.stdout.includes('Setup cancelled')) {
    fail('installer did not print cancellation guidance when .env is missing after wizard');
  }
  if (existsSync(join(INSTALL_DIR4, 'current', '.env'))) {
    fail('.env should not exist when wizard exits successfully with no file created');
  }
  if (cancelRes.stdout.includes('Start the stack now?')) {
    fail('installer should not prompt to start the stack after wizard cancellation');
  }
  log('  cancelled wizard detected, installer exited gracefully without startup prompts');

  log('all installer checks passed');
} finally {
  await cleanup();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function sha256Of(file: string): string {
  const buf = readFileSync(file);
  return `${createHash('sha256').update(buf).digest('hex')}  ${join(file).split('/').pop()}`;
}

function tarCzf(outFile: string, cwd: string, topDir: string, dirName: string): void {
  const res = spawnSync('tar', ['-czf', outFile, '-C', join(cwd, topDir), dirName], {
    cwd,
    stdio: 'ignore',
  });
  if (res.status !== 0) {
    throw new Error(`tar failed: ${res.stderr}`);
  }
}

function tarList(tarball: string): string[] {
  const res = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
  return (res.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
