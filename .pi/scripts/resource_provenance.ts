// .pi/scripts/resource_provenance.ts
//
// C-478 AC-5: Provenance and rollback are inspectable.
// Generates a human-readable provenance report showing exact managed inputs,
// profile identity, and unmanaged coverage gaps.
//
// Usage:
//   bun run resource-provenance              # print report to stdout
//   bun run resource-provenance --json        # JSON output for tooling
//   bun run resource-provenance --rollback    # show rollback instructions
//   bun run resource-provenance --help        # show help

import { existsSync } from 'node:fs';

import {
  formatProvenanceReport,
  generateProvenanceReport,
  loadManifest,
  MANIFEST_PATH,
} from './resource_manifest.ts';

// ── Constants ────────────────────────────────────────────────────────

const ROLLBACK_INSTRUCTIONS = `
Rollback Instructions
=====================

To roll back resources to a previous committed state:

1. Check the previous resource manifest:
   git show HEAD~1:.pi/resource-manifest.json

2. Restore the previous manifest:
   git checkout HEAD~1 -- .pi/resource-manifest.json

3. Restore generated skills from the previous commit:
   git checkout HEAD~1 -- .pi/generated-skills/

4. Restore settings from the previous commit:
   git checkout HEAD~1 -- .pi/settings.json

5. Reinstall npm packages to match the previous lockfile:
   cd .pi && bun install

6. Verify the rollback:
   bun run resource-check

Testing Before Using a Rollback
--------------------------------
- Run \`bun run resource-check\` to verify all resources match the manifest.
- Run \`bun run test\` to verify extension registration and loading.
- Verify that the agent loads and operates correctly with the rolled-back resources.
- If rollback breaks agent functionality, restore forward:
  git checkout HEAD -- .pi/resource-manifest.json .pi/generated-skills/ .pi/settings.json
`;

// ── Main ─────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Usage: bun run resource-provenance [options]

Options:
  --json        Output as JSON for tooling
  --rollback    Show rollback instructions
  --help        Show this help

Examples:
  bun run resource-provenance         # print human-readable report
  bun run resource-provenance --json  # machine-readable JSON
  bun run resource-provenance --rollback  # show rollback guide
`);
    process.exit(0);
  }

  if (args.includes('--rollback')) {
    console.log(ROLLBACK_INSTRUCTIONS);
    process.exit(0);
  }

  if (!existsSync(MANIFEST_PATH)) {
    console.error('❌ No resource manifest found at', MANIFEST_PATH);
    console.error('   Run `bun run resource-update` to create one.');
    process.exit(2);
  }

  const manifest = await loadManifest();
  if (!manifest) {
    console.error('❌ Failed to load resource manifest.');
    process.exit(2);
  }

  const report = await generateProvenanceReport(manifest);

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatProvenanceReport(report));
  }
};

// Only auto-run when executed directly (not when imported as a module by tests)
const isDirectExecution = process.argv[1]?.endsWith('resource_provenance.ts');
if (isDirectExecution) {
  main().catch((err: Error) => {
    console.error('resource-provenance failed:', err.message);
    process.exit(2);
  });
}
