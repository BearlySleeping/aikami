// apps/frontend/gamejs/scripts/debug.ts
/**
 * Development/debug launcher. Builds the project and starts Godot.
 * For automated test scenes, use `scripts/test.ts` instead.
 */
import { buildAndRun, resolveMode } from './lib/build';

const args = process.argv.slice(2);
let mode: string | undefined;
const godotArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode' && args[i + 1]) {
    mode = args[i + 1];
    i++;
  } else if (args[i].startsWith('--mode=')) {
    mode = args[i].replace('--mode=', '');
  } else {
    godotArgs.push(args[i]);
  }
}

const result = await buildAndRun({
  mode: resolveMode(mode),
  godotArgs,
  inheritStdio: true,
});

process.exit(result.exitCode);
