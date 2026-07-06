// scripts/src/lib/agents/sandbox_scaffolder.ts
/**
 * Auto-Sandbox Agent Scaffolding Lifecycle (C-305).
 *
 * Automated playground builder that intercepts state/ViewModel changes and
 * programmatically creates isolated dev sandbox routes under the client project.
 *
 * When triggered by the swarm director, the scaffolder:
 * 1. Evaluates the target change file name
 * 2. Constructs a unique snake_case route directory under (dev)/dev/(sandbox)/sandbox/
 * 3. Generates a pure template +page.svelte file (logicless view)
 * 4. Injects the component ViewModel via its factory wrapper
 * 5. Registers the new route in .pi/healing_context.json for visual runner integration
 * 6. Cleans up orphaned sandbox directories via scratchpad tracking
 *
 * Usage:
 *   bun run scripts/src/lib/agents/sandbox_scaffolder.ts --mock-target UserComponent
 *   bun run scripts/src/lib/agents/sandbox_scaffolder.ts --cleanup
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

// ── Types ──────────────────────────────────────────────────

/** Configuration for scaffold generation. */
export type SandboxScaffoldConfig = {
  /** URL-safe route segment (snake_case) */
  routeSegmentName: string;
  /** Class name of the ViewModel to instantiate */
  targetViewModelClassName: string;
  /** Reference key for the mock data service */
  mockDataServiceReferenceKey: string;
  /** Viewport dimensions for visual tests */
  viewportDimensions: {
    width: number;
    height: number;
  };
};

/** Log entry recorded for each scaffolded route. */
export type ScaffoldRegisterLog = {
  scaffoldId: string;
  relativeRoutePath: string;
  generatedFilePaths: string[];
  timestamp: string;
};

// ── Constants ──────────────────────────────────────────────

const CLIENT_ROOT = resolve(import.meta.dir, '..', '..', '..', 'apps', 'frontend', 'client');
const SANDBOX_ROUTE_BASE = resolve(
  CLIENT_ROOT,
  'src',
  'routes',
  '(dev)',
  'dev',
  '(sandbox)',
  'sandbox',
);

const HEALING_CONTEXT_PATH = resolve(CLIENT_ROOT, '..', '..', '..', '.pi', 'healing_context.json');
const SCAFFOLD_REGISTRY_KEY = 'sandbox_scaffolds';

/** Simple hash for scaffold IDs. */
const _hash = (input: string): string => {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return `s_${Math.abs(h).toString(16).padStart(8, '0')}`;
};

// ── Svelte template generation ─────────────────────────────

/**
 * Generate a logicless +page.svelte file content.
 *
 * Follows the exact pattern: line 1 path comment, minimal imports,
 * ViewModel factory instantiation, no data transformation or logic.
 */
const _generatePageTemplate = (config: SandboxScaffoldConfig): string => {
  const routePath = `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/${config.routeSegmentName}/+page.svelte`;
  const factoryName = `get${config.targetViewModelClassName}`;
  const interfaceName = `${config.targetViewModelClassName}Interface`;

  return `<script lang="ts">
  // ${routePath}
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import {
    ${factoryName},
    type ${interfaceName},
  } from './${config.routeSegmentName}_view_model.svelte';

  const viewModel: ${interfaceName} = ${factoryName}({
    className: '${config.targetViewModelClassName}',
  });
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div class="relative flex h-full w-full items-center justify-center">
    {#if !viewModel.isReady}
      <div class="flex flex-col items-center gap-3">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <p class="text-sm text-base-content/60">
          Loading sandbox: ${config.routeSegmentName}
        </p>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-4 rounded-xl border border-base-300 bg-base-200 p-6 shadow-lg">
        <p class="text-lg font-semibold">${config.targetViewModelClassName}</p>
        <p class="text-sm text-base-content/50">
          Sandbox viewport: ${config.viewportDimensions.width}×${config.viewportDimensions.height}
        </p>
        <p class="text-xs text-base-content/40">
          Mock service: ${config.mockDataServiceReferenceKey}
        </p>
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
`;
};

/**
 * Generate a minimal ViewModel stub with factory export.
 */
const _generateViewModelStub = (config: SandboxScaffoldConfig): string => {
  const factoryName = `get${config.targetViewModelClassName}`;
  const interfaceName = `${config.targetViewModelClassName}Interface`;
  const className = config.targetViewModelClassName;
  const viewModelPath = `${SANDBOX_ROUTE_BASE}/${config.routeSegmentName}/${config.routeSegmentName}_view_model.svelte.ts`;

  return `// ${viewModelPath}
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '$lib/components/base_view_model.svelte';
import { ${config.mockDataServiceReferenceKey} } from '$services';

export type ${interfaceName} = BaseViewModelInterface & {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
};

export type ${className}Options = BaseViewModelOptions & {};

export class ${className}
  extends BaseViewModel<${className}Options>
  implements ${interfaceName}
{
  viewportWidth = $state<number>(${config.viewportDimensions.width});
  viewportHeight = $state<number>(${config.viewportDimensions.height});

  async initialize(): Promise<void> {
    this.debug('initialize');

    // Mock data injection via service reference
    this.debug('mock-service', {
      service: '${config.mockDataServiceReferenceKey}',
    });

    await super.initialize();
  }
}

export const ${factoryName} = (
  options: ${className}Options,
): ${interfaceName} => ${className}.create(options);
`;
};

// ── Healing context integration ────────────────────────────

/**
 * Read the current healing context file, or return null if it doesn't exist.
 */
const _readHealingContext = (): Record<string, unknown> | null => {
  if (!existsSync(HEALING_CONTEXT_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(HEALING_CONTEXT_PATH, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * Append a scaffold registry entry to the healing context.
 */
const _registerInHealingContext = (log: ScaffoldRegisterLog): void => {
  const context = _readHealingContext() ?? {};

  const registry = (context[SCAFFOLD_REGISTRY_KEY] as ScaffoldRegisterLog[]) ?? [];
  registry.push(log);
  context[SCAFFOLD_REGISTRY_KEY] = registry;
  context.lastScaffoldTimestamp = log.timestamp;

  writeFileSync(HEALING_CONTEXT_PATH, JSON.stringify(context, null, 2));
};

// ── Scaffolding ────────────────────────────────────────────

/**
 * Scaffold a new sandbox route for a target ViewModel component.
 *
 * AC-1: Automated Isolated Route Provisioning
 * - Evaluates the target change file
 * - Constructs a unique snake_case route directory
 * - Generates +page.svelte (logicless) + ViewModel stub with factory wrapper
 *
 * AC-2: Visual Runner Integration Loop
 * - Compiles metadata registry object
 * - Injects route parameters into healing_context.json for test_healer.ts
 */
export const scaffoldSandbox = (config: SandboxScaffoldConfig): ScaffoldRegisterLog => {
  const routeDir = resolve(SANDBOX_ROUTE_BASE, config.routeSegmentName);

  // ── Create route directory ────────────────────────────
  if (!existsSync(routeDir)) {
    mkdirSync(routeDir, { recursive: true });
  }

  // ── Generate files ────────────────────────────────────
  const pagePath = resolve(routeDir, '+page.svelte');
  const viewModelPath = resolve(routeDir, `${config.routeSegmentName}_view_model.svelte.ts`);

  const pageContent = _generatePageTemplate(config);
  const vmContent = _generateViewModelStub(config);

  writeFileSync(pagePath, pageContent);
  writeFileSync(viewModelPath, vmContent);

  const scaffoldId = _hash(`${config.routeSegmentName}_${Date.now()}`);

  const log: ScaffoldRegisterLog = {
    scaffoldId,
    relativeRoutePath: relative(CLIENT_ROOT, routeDir),
    generatedFilePaths: [relative(CLIENT_ROOT, pagePath), relative(CLIENT_ROOT, viewModelPath)],
    timestamp: new Date().toISOString(),
  };

  // ── Register in healing context ───────────────────────
  _registerInHealingContext(log);

  console.log('[scaffolder] Route scaffolded:', {
    route: config.routeSegmentName,
    scaffoldId,
    files: log.generatedFilePaths,
  });

  return log;
};

// ── Orphan cleanup ─────────────────────────────────────────

/**
 * Clean up orphaned sandbox directories that are no longer in the registry.
 *
 * Queries the healing context registry to identify directories no longer
 * tracked, then removes them from disk.
 *
 * Edge case: Frequent scaffolding steps leave empty folders over time.
 * This garbage-collects old, untracked playground structures.
 */
export const cleanupOrphanedSandboxes = (): string[] => {
  const context = _readHealingContext();
  const registry = (context?.[SCAFFOLD_REGISTRY_KEY] as ScaffoldRegisterLog[]) ?? [];

  const trackedPaths = new Set(
    registry.map((r) => resolve(SANDBOX_ROUTE_BASE, r.relativeRoutePath)),
  );

  if (!existsSync(SANDBOX_ROUTE_BASE)) {
    return [];
  }

  const removed: string[] = [];
  const entries = readdirSync(SANDBOX_ROUTE_BASE, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = resolve(SANDBOX_ROUTE_BASE, entry.name);

    if (!trackedPaths.has(fullPath)) {
      // Skip directories that are not scaffolded (production sandboxes)
      const hasPageFile = existsSync(resolve(fullPath, '+page.svelte'));
      const hasVmFile = readdirSync(fullPath).some((f) => f.endsWith('_view_model.svelte.ts'));

      // Only remove directories that look like scaffolded sandboxes
      if (hasPageFile && hasVmFile) {
        try {
          // Remove files first, then directory
          const files = readdirSync(fullPath);
          for (const file of files) {
            const filePath = resolve(fullPath, file);
            unlinkSync(filePath);
          }
          rmdirSync(fullPath);
          removed.push(entry.name);
        } catch {
          // Skip if can't remove (permissions, open handles)
        }
      }
    }
  }

  if (removed.length > 0) {
    console.log('[scaffolder] Cleaned up orphaned sandboxes:', removed);
  }

  return removed;
};

// ── CLI ────────────────────────────────────────────────────

const main = (): void => {
  const args = process.argv.slice(2);

  if (args.includes('--cleanup')) {
    const removed = cleanupOrphanedSandboxes();
    console.log(`[scaffolder] Removed ${removed.length} orphaned sandbox(es)`);
    process.exit(0);
  }

  const mockTarget = args.includes('--mock-target')
    ? args[args.indexOf('--mock-target') + 1]
    : undefined;

  if (!mockTarget) {
    console.error('Usage: bun run sandbox_scaffolder.ts --mock-target <ClassName>');
    console.error('       bun run sandbox_scaffolder.ts --cleanup');
    process.exit(1);
  }

  const routeSegment = mockTarget
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/_{2,}/g, '_');

  const config: SandboxScaffoldConfig = {
    routeSegmentName: routeSegment,
    targetViewModelClassName: mockTarget,
    mockDataServiceReferenceKey: 'mockDataService',
    viewportDimensions: {
      width: 1280,
      height: 720,
    },
  };

  scaffoldSandbox(config);
};

main();
