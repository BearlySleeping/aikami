// Standalone entry point, executed by a real `node` process (never bun) via
// `node node_loader_runner.ts <extension-file>`. Loads one .pi extension
// against a minimal recording stand-in for the pi API — the same shape
// registration.test.ts uses — and reports success/failure over the exit
// code so a parent process (bun test, under runtime_boundary.test.ts) can
// assert on real production-runtime behavior instead of a source grep.
//
// Extensions use extensionless relative imports (e.g. `from
// '../../scripts/src/lib/.../contract_sync'`), which plain Node ESM refuses
// to resolve. Production pi does NOT use plain `import()` for this either —
// its loader (@earendil-works/pi-coding-agent dist/core/extensions/loader.js)
// resolves every extension through `jiti` with `tsconfigPaths: true`. This
// runner uses the same resolver the same way, so a failure here reflects a
// real production-loading break, not a gap between this harness and pi.
import { createJiti } from 'jiti';

const target = process.argv[2];
if (!target) {
  console.error('usage: node node_loader_runner.ts <extension-file>');
  process.exit(2);
}

// Same "answer anything with a no-op" shape as .pi/scripts/measure_tool_surface.ts
// and .pi/extensions/lib/registration.test.ts's stand-in — real extensions
// call several pi.* members (registerCommand, on, registerFlag, ...) beyond
// registerTool, and this runner's job is to prove the module *loads*, not
// to model the full pi API.
const pi = new Proxy(
  { registerTool: (_tool: unknown) => {} },
  {
    get: (proxyTarget, prop) =>
      prop in proxyTarget ? Reflect.get(proxyTarget, prop) : () => undefined,
  },
);

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const module = (await jiti.import(target)) as {
    default?: (api: unknown) => void | Promise<void>;
  };
  const factory = module.default;
  if (typeof factory !== 'function') {
    throw new Error(`${target} does not export a default factory function`);
  }
  await factory(pi);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
