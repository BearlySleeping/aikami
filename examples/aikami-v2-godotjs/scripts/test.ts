// apps/frontend/gamejs/scripts/test.ts
/**
 * Dynamic test scene runner for GodotJS.
 *
 * Discovers `.tscn` files in `src/scenes/test/` and runs them headlessly.
 * Supports running all tests, a single test by name, or tests matching a pattern.
 *
 * Usage:
 *   bun run test:scenes              # Run all test scenes
 *   bun run test:scenes -- ai        # Run scenes matching "ai"
 *   bun run test:scenes -- ai_manager # Run specific scene
 *   bun run test:scenes -- --mode=emulator  # Use emulator env (default: development)
 *   bun run test:scenes -- --list    # List available test scenes
 */
import fs from 'node:fs';
import path from 'node:path';
import { setupEnv, runGodotTsBuild, resolveMode, type BuildMode } from './lib/build';

const TEST_SCENES_DIR = 'src/scenes/test';
const DEFAULT_TIMEOUT_MS = 30000;

type TestScene = {
  name: string;
  filePath: string;
  resPath: string;
};

type TestResult = {
  name: string;
  passed: boolean;
  exitCode: number;
  durationMs: number;
};

type RunOptions = {
  mode: BuildMode;
  pattern?: string;
  listOnly: boolean;
  timeoutMs: number;
};

function discoverTestScenes(): TestScene[] {
  if (!fs.existsSync(TEST_SCENES_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(TEST_SCENES_DIR);
  const scenes: TestScene[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.tscn')) {
      continue;
    }
    const name = entry.replace('.tscn', '');
    const filePath = path.join(TEST_SCENES_DIR, entry);
    const resPath = `res://${filePath}`;
    scenes.push({ name, filePath, resPath });
  }

  return scenes.sort((a, b) => a.name.localeCompare(b.name));
}

function filterScenes(scenes: TestScene[], pattern?: string): TestScene[] {
  if (!pattern) {
    return scenes;
  }
  const lowerPattern = pattern.toLowerCase();
  return scenes.filter((s) => s.name.toLowerCase().includes(lowerPattern));
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  let mode: BuildMode = 'development';
  let pattern: string | undefined;
  let listOnly = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--mode' && args[i + 1]) {
      mode = resolveMode(args[i + 1]);
      i++;
    } else if (arg.startsWith('--mode=')) {
      mode = resolveMode(arg.replace('--mode=', ''));
    } else if (arg === '--list') {
      listOnly = true;
    } else if (arg === '--timeout' && args[i + 1]) {
      timeoutMs = Number.parseInt(args[i + 1], 10);
      i++;
    } else if (arg.startsWith('--timeout=')) {
      timeoutMs = Number.parseInt(arg.replace('--timeout=', ''), 10);
    } else if (!arg.startsWith('--')) {
      // Positional argument = pattern
      if (!pattern) {
        pattern = arg;
      }
    }
  }

  return { mode, pattern, listOnly, timeoutMs };
}

async function runTestScene(scene: TestScene, timeoutMs: number): Promise<TestResult> {
  const start = Date.now();

  const godot = Bun.spawn(
    ['godot', '--headless', '--scene', scene.resPath],
    { stdout: 'pipe', stderr: 'pipe' },
  );

  let output = '';
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      godot.kill();
    } catch {
      // Ignore kill errors
    }
  }, timeoutMs);

  // Collect stdout
  godot.stdout.pipeTo(
    new WritableStream({
      write(chunk) {
        output += chunk.toString();
      },
    }),
  );

  // Collect stderr in parallel
  const stderrPromise = (async () => {
    const reader = godot.stderr.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      output += new TextDecoder().decode(value);
    }
  })();

  const exitCode = await godot.exited;
  clearTimeout(timeout);
  await stderrPromise.catch(() => {
    // Ignore stderr read errors after process exit
  });

  const durationMs = Date.now() - start;

  // Print the scene output so logs are visible
  if (output.trim()) {
    console.log(output);
  }

  if (timedOut) {
    console.error(`❌ ${scene.name}: TIMED OUT after ${timeoutMs}ms`);
    return { name: scene.name, passed: false, exitCode: -1, durationMs };
  }

  const passed = exitCode === 0;
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${scene.name}: ${passed ? 'PASSED' : 'FAILED'} (exit ${exitCode}, ${durationMs}ms)`);

  return { name: scene.name, passed, exitCode, durationMs };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const allScenes = discoverTestScenes();

  if (allScenes.length === 0) {
    console.error('No test scenes found in', TEST_SCENES_DIR);
    process.exit(1);
  }

  if (options.listOnly) {
    console.log('Available test scenes:');
    for (const scene of allScenes) {
      console.log(`  - ${scene.name}`);
    }
    return;
  }

  const scenesToRun = filterScenes(allScenes, options.pattern);

  if (scenesToRun.length === 0) {
    console.error(`No test scenes match pattern: "${options.pattern}"`);
    console.log('Available scenes:');
    for (const scene of allScenes) {
      console.log(`  - ${scene.name}`);
    }
    process.exit(1);
  }

  console.log(`Running ${scenesToRun.length} test scene(s) in ${options.mode} mode...`);
  if (options.pattern) {
    console.log(`Pattern: "${options.pattern}"`);
  }
  console.log();

  await setupEnv(options.mode);

  const buildOk = await runGodotTsBuild();
  if (!buildOk) {
    process.exit(1);
  }

  const results: TestResult[] = [];

  for (const scene of scenesToRun) {
    console.log(`\n--- Running: ${scene.name} ---`);
    const result = await runTestScene(scene, options.timeoutMs);
    results.push(result);
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n========================================');
  console.log('             TEST SUMMARY');
  console.log('========================================');
  console.log(`Total:  ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('----------------------------------------');

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name} (${result.durationMs}ms)`);
  }

  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
