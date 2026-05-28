// apps/frontend/gamejs/scripts/lib/build.ts
/**
 * Shared build utilities for GodotJS scripts.
 * Handles environment setup, godot-ts compilation, and Godot spawning.
 */

const VALID_MODES = ['development', 'emulator', 'production'] as const;
export type BuildMode = (typeof VALID_MODES)[number];

export type BuildOptions = {
  mode?: BuildMode;
  godotArgs?: string[];
  inheritStdio?: boolean;
};

export type BuildResult = {
  success: boolean;
  exitCode: number;
};

/**
 * Validate and normalize the build mode.
 */
export function resolveMode(mode?: string): BuildMode {
  const m = (mode ?? 'development').toLowerCase();
  if (!VALID_MODES.includes(m as BuildMode)) {
    throw new Error(`Invalid mode "${m}". Valid modes: ${VALID_MODES.join(', ')}`);
  }
  return m as BuildMode;
}

/**
 * Copy the appropriate .env.{mode} file to .env.
 */
export async function setupEnv(mode: BuildMode): Promise<void> {
  const envPath = `.env.${mode}`;
  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    throw new Error(`Environment file not found: ${envPath}`);
  }

  console.log('Loading environment:', mode);
  await Bun.write(Bun.file('.env'), envFile);
  console.log('Copied', envPath, 'to .env');

  const envContent = await Bun.file('.env').text();
  const lines = envContent.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
  for (const line of lines) {
    console.log(' ', line);
  }
}

/**
 * Run godot-ts build and return whether it succeeded.
 */
export async function runGodotTsBuild(): Promise<boolean> {
  console.log('\nBuilding...');
  const build = Bun.spawn(['godot-ts', 'build'], { stdout: 'pipe', stderr: 'pipe' });
  const [buildOut, buildErr] = await Promise.all([build.stdout.text(), build.stderr.text()]);

  if (buildOut.trim()) {
    console.log(buildOut);
  }
  if (buildErr.trim()) {
    console.error(buildErr);
  }

  const buildCode = await build.exited;
  if (buildCode !== 0) {
    console.error('Build failed with code:', buildCode);
    return false;
  }
  return true;
}

/**
 * Spawn Godot with the given arguments.
 * When inheritStdio is true, stdout/stderr are inherited (for dev/editor).
 * When false, they are piped and the process object is returned.
 */
export function spawnGodot(godotArgs: string[], inheritStdio: boolean): Subprocess {
  console.log('\nLaunching Godot...', ...godotArgs);
  return Bun.spawn(['godot', ...godotArgs], {
    stdout: inheritStdio ? 'inherit' : 'pipe',
    stderr: inheritStdio ? 'inherit' : 'pipe',
  });
}

/**
 * Full build-and-run pipeline used by debug.ts and test.ts.
 */
export async function buildAndRun(options: BuildOptions): Promise<BuildResult> {
  const mode = resolveMode(options.mode);
  await setupEnv(mode);

  const buildOk = await runGodotTsBuild();
  if (!buildOk) {
    return { success: false, exitCode: 1 };
  }

  const godot = spawnGodot(options.godotArgs ?? [], options.inheritStdio ?? true);
  const exitCode = await godot.exited;
  return { success: exitCode === 0, exitCode: exitCode ?? 0 };
}
