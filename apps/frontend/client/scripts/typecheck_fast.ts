#!/usr/bin/env bun
// apps/frontend/client/scripts/typecheck_fast.ts
//
// Fast local typecheck: `svelte-check-rs` (Svelte files, incl. their
// `<script>` blocks) and `tsgo --noEmit` (standalone .ts files) run
// concurrently and their outputs are printed as each finishes.
//
// Split because svelte-check-rs only checks `.svelte` files — it never scans
// standalone `.ts` files (verified: a deliberately broken .ts probe file
// produced zero diagnostics). tsgo covers that gap; `.svelte` imports resolve
// through svelte's own ambient `declare module '*.svelte'`, so tsgo doesn't
// need svelte2tsx conversion to typecheck the .ts side of the graph.
//
// `typecheck` (svelte-check) remains the authoritative CI gate — this is a
// faster, best-effort local pass and may have gaps neither tool covers.

// biome-ignore-all lint/suspicious/noConsole: standalone script, no logger context

const runCheck = async (name: string, cmd: string[]) => {
  const proc = Bun.spawn(cmd, {
    cwd: `${import.meta.dir}/..`,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  console.log(`\n--- ${name} ---`);
  if (stdout.trim()) {
    console.log(stdout.trim());
  }
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  return exitCode === 0;
};

const [checkRsOk, tsgoOk] = await Promise.all([
  runCheck('svelte-check-rs', ['bun', 'x', 'svelte-check-rs']),
  runCheck('tsgo', ['bun', 'x', 'tsgo', '--noEmit', '-p', 'tsconfig.json']),
]);

process.exit(checkRsOk && tsgoOk ? 0 : 1);
