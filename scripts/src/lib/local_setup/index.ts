#!/usr/bin/env bun
// scripts/src/lib/local_setup/index.ts
/**
 * Aikami Local Machine Setup — CLI guide
 *
 * Checks the developer's machine for the tools needed to work on Aikami
 * and prints copy-paste install commands for anything missing.
 *
 * 🔴 This is LOCAL machine setup. The GCP cloud project wizard lives at
 *    scripts/src/lib/project_setup/ (run: bun run project:setup).
 *
 * What it checks, by category:
 *   essentials — bun, git                       (required for any dev work)
 *   dx         — pi, herdr                      (optional agent tools)
 *   emulator   — jdk, chromium                  (needed for bun run dev:all)
 *   tauri      — rust, webkit2gtk, gtk3, ...    (needed for bun tauri build)
 *
 * The recommended path (direnv + nix + flake.nix) provides all of the above
 * automatically, so it's surfaced as a recommendation, not a tool check.
 *
 * Usage:
 *   bun run setup                        # interactive CLI guide (default)
 *   bun run setup --check                # non-interactive; exit 1 if essentials missing
 *   bun run setup --only=essentials      # only check one category
 *   bun run setup --only=dx,tauri        # ...or several
 *   bun run setup --json                 # machine-readable summary
 */

import { c, fmt, parseCliArgs, run } from '../cli_utils';

// ─── Types ────────────────────────────────────────────────────────────────
type Platform = NodeJS.Platform;
type Category = 'essentials' | 'dx' | 'emulator' | 'tauri';

type ToolCheck = {
  /** Display name, e.g. 'Bun'. */
  name: string;
  /** Executable(s) to probe on PATH, in order. */
  bins: string[];
  /** Human-readable reason this tool is needed. */
  why: string;
  category: Category;
  /** Version probe (defaults to `--version`). */
  versionArgs?: string[];
  /** Non-empty version output = ok (default). Override for stricter checks. */
  verify?: (out: string) => boolean | Promise<boolean>;
  /** Only relevant on these platforms (default: all). */
  platforms?: Platform[];
  /** Copy-paste install commands, per platform. */
  install: Partial<Record<Platform, { label: string; commands: string[] }>>;
  /** Extra note shown under the check when it's missing. */
  hint?: string;
};

type CheckResult = {
  tool: ToolCheck;
  present: boolean;
  version?: string;
  detail?: string;
};

const CATEGORY_META: Record<Category, { title: string; desc: string }> = {
  essentials: { title: 'Essentials', desc: 'Required for any development work' },
  dx: { title: 'Agent Tools (optional)', desc: 'pi, herdr — not provided by the flake' },
  emulator: {
    title: 'Firebase Emulator (optional)',
    desc: 'Required for `bun run dev:all` (local Firebase)',
  },
  tauri: {
    title: 'Tauri Desktop Build (optional)',
    desc: 'Required for `bun tauri build` (Linux packages)',
  },
};

/**
 * The recommended path: direnv + nix + flake.nix provides bun, jdk,
 * chromium, playwright browsers, tauri deps, gcloud, and herdr automatically.
 * Not a "check" — it's the umbrella recommendation. If the user already has
 * direnv, they don't need the rest of this guide.
 */
const RECOMMENDED_INSTALL: Partial<Record<Platform, { label: string; commands: string[] }>> = {
  linux: {
    label: 'Install Nix + direnv + nix-direnv',
    commands: [
      'curl -L https://nixos.org/nix/install | sh',
      'nix profile install nixpkgs#direnv nixpkgs#nix-direnv',
      'mkdir -p ~/.config/direnv && echo "source $HOME/.nix-profile/share/nix-direnv/direnvrc" >> ~/.config/direnv/direnvrc',
    ],
  },
  darwin: {
    label: 'Install Nix + direnv + nix-direnv',
    commands: [
      'curl -L https://nixos.org/nix/install | sh',
      'nix profile install nixpkgs#direnv nixpkgs#nix-direnv',
      'mkdir -p ~/.config/direnv && echo "source $HOME/.nix-profile/share/nix-direnv/direnvrc" >> ~/.config/direnv/direnvrc',
    ],
  },
  win32: {
    label: 'Use WSL',
    commands: ['# nix + direnv require a POSIX shell — install WSL, then follow the Linux steps'],
  },
};

// ─── Tool definitions ─────────────────────────────────────────────────────
const TOOLS: ToolCheck[] = [
  // ── Essentials ─────────────────────────────────────────────────────
  {
    name: 'Bun',
    bins: ['bun'],
    why: 'Runtime + package manager for the whole monorepo. Required.',
    category: 'essentials',
    verify: (out) => /^1\.\d+/.test(out.trim()),
    install: {
      linux: {
        label: 'Install Bun (curl)',
        commands: ['curl -fsSL https://bun.sh/install | bash'],
      },
      darwin: {
        label: 'Install Bun (curl)',
        commands: ['curl -fsSL https://bun.sh/install | bash'],
      },
      win32: {
        label: 'Install Bun (PowerShell)',
        commands: ['powershell -c "irm bun.sh/install.ps1 | iex"'],
      },
    },
    hint: 'Bun 1.x required. After install, restart your shell.',
  },
  {
    name: 'git',
    bins: ['git'],
    why: 'Version control — needed to clone/pull/push. Required.',
    category: 'essentials',
    verify: (out) => /git version 2\.\d+/.test(out.trim()),
    install: {
      linux: { label: 'Install git (apt)', commands: ['sudo apt-get install -y git'] },
      darwin: { label: 'Install Xcode Command Line Tools', commands: ['xcode-select --install'] },
      win32: { label: 'Install git (winget)', commands: ['winget install --id Git.Git'] },
    },
  },

  // ── Agent tools (optional) ────────────────────────────────────────
  {
    name: 'pi',
    bins: ['pi'],
    why: 'AI coding agent with project-specific skills (.pi/). Optional.',
    category: 'dx',
    install: {
      linux: {
        label: 'Install pi globally (npm)',
        commands: ['npm install -g --ignore-scripts @earendil-works/pi-coding-agent'],
      },
      darwin: {
        label: 'Install pi globally (npm)',
        commands: ['npm install -g --ignore-scripts @earendil-works/pi-coding-agent'],
      },
      win32: {
        label: 'Install pi globally (npm)',
        commands: ['npm install -g --ignore-scripts @earendil-works/pi-coding-agent'],
      },
    },
  },
  {
    name: 'herdr',
    bins: ['herdr'],
    why: 'Terminal-native service multiplexer for `bun run dev:all` / `bun herdr:*`. Optional.',
    category: 'dx',
    install: {
      linux: {
        label: 'Install herdr (nix profile)',
        commands: ['nix profile install github:ogulcancelik/herdr'],
      },
      darwin: {
        label: 'Install herdr (nix profile)',
        commands: ['nix profile install github:ogulcancelik/herdr'],
      },
      win32: {
        label: 'Install herdr (nix profile / WSL)',
        commands: ['nix profile install github:ogulcancelik/herdr'],
      },
    },
    hint: 'Also provided automatically inside the flake devShell (flake.nix).',
  },

  // ── Emulator (optional) ────────────────────────────────────────────
  {
    name: 'JDK',
    bins: ['java'],
    why: 'Required by the Firebase Emulator Suite (firebase emulators:start).',
    category: 'emulator',
    versionArgs: ['-version'],
    verify: (out) => {
      // Parse Java major version from both legacy (1.8.0_292) and current (17.0.2, 21) formats
      const legacyMatch = out.match(/version "1\.(\d+)/);
      if (legacyMatch) {
        const major = parseInt(legacyMatch[1], 10);
        return major >= 17;
      }
      const currentMatch = out.match(/version "(\d+)/);
      if (currentMatch) {
        const major = parseInt(currentMatch[1], 10);
        return major >= 17;
      }
      // Unparseable output - reject
      return false;
    },
    install: {
      linux: {
        label: 'Install OpenJDK 21 (apt)',
        commands: ['sudo apt-get install -y openjdk-21-jdk'],
      },
      darwin: { label: 'Install OpenJDK (brew)', commands: ['brew install openjdk'] },
      win32: {
        label: 'Install OpenJDK 21 (winget)',
        commands: ['winget install --id Microsoft.OpenJDK.21'],
      },
    },
    hint: 'Any JDK 17+ works. The flake devShell already provides jdk.',
  },
  {
    name: 'Chromium',
    bins: ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'],
    why: 'Used by Playwright E2E tests and the dev browser.',
    category: 'emulator',
    install: {
      linux: { label: 'Install Chromium (apt)', commands: ['sudo apt-get install -y chromium'] },
      darwin: { label: 'Install Chromium (brew)', commands: ['brew install --cask chromium'] },
      win32: { label: 'Install Chrome (winget)', commands: ['winget install --id Google.Chrome'] },
    },
    hint: 'The flake devShell ships a chromium wrapper with PixiJS DevTools.',
  },

  // ── Tauri (optional) ───────────────────────────────────────────────
  {
    name: 'Rust toolchain',
    bins: ['cargo', 'rustc'],
    why: 'Compiles the Tauri desktop shell (bun tauri build).',
    category: 'tauri',
    versionArgs: ['--version'],
    install: {
      linux: {
        label: 'Install Rust (rustup)',
        commands: ["curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"],
      },
      darwin: {
        label: 'Install Rust (rustup)',
        commands: ["curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"],
      },
      win32: {
        label: 'Install Rust (rustup, MSVC toolchain)',
        commands: ['winget install --id Rustlang.Rustup', 'rustup default stable-msvc'],
      },
    },
  },
  {
    name: 'Tauri system libs',
    bins: ['pkg-config'],
    why: 'Linux webview/GTK libraries needed to link the Tauri shell.',
    category: 'tauri',
    platforms: ['linux'],
    verify: async () => {
      const { code } = await run([
        'pkg-config',
        '--exists',
        'webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 javascriptcoregtk-4.1',
      ]);
      return code === 0;
    },
    install: {
      linux: {
        label: 'Install Tauri Linux deps (apt)',
        commands: [
          'sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev',
        ],
      },
    },
    hint: 'Linux only. macOS uses the system WebKit; Windows uses WebView2.',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

async function probe(tool: ToolCheck): Promise<{ path?: string; out: string }> {
  let lastFailure: { path: string; out: string } | undefined;
  for (const bin of tool.bins) {
    const found = Bun.which(bin);
    if (!found) {
      continue;
    }
    const args = tool.versionArgs ?? ['--version'];
    try {
      const { out, err, code } = await run([bin, ...args]);
      // Some tools (java) report version on stderr — merge both.
      const combined = `${out}\n${err}`.trim();
      if (code === 0 && combined.length > 0) {
        return { path: found, out: combined };
      }
      if (code === 0) {
        return { path: found, out: '(no version output)' };
      }
      // Non-zero exit: save failure and continue to next candidate
      lastFailure = { path: found, out: combined || '(version probe failed)' };
    } catch {
      // Command threw: save failure and continue to next candidate
      lastFailure = { path: found, out: '(version probe failed)' };
    }
  }
  // All candidates failed or none found
  return lastFailure ?? { out: '' };
}

function formatVersion(raw: string): string {
  const first = raw.split('\n')[0]?.trim() ?? '';
  return first.replace(/^bun\s+/i, '');
}

/** Probe whether the recommended direnv+nix path is available. */
async function probeRecommended(): Promise<{ direnv: boolean; nix: boolean }> {
  return {
    direnv: Boolean(Bun.which('direnv')),
    nix: Boolean(Bun.which('nix')),
  };
}

function printRecommendedSection(recommended: { direnv: boolean; nix: boolean }): void {
  console.log(fmt.section('Recommended path — direnv + Nix flake'));

  if (recommended.direnv && recommended.nix) {
    console.log(fmt.ok('direnv + nix found — the flake provides everything else'));
    console.log(
      fmt.note('Run: direnv allow (one-time), then the devShell loads bun, jdk, chromium,'),
    );
    console.log(fmt.note('playwright browsers, tauri deps, gcloud, and herdr automatically.'));
    console.log(fmt.note('You can skip the individual tool checks below.'));
    return;
  }

  console.log(fmt.warn('Not using direnv + nix? The tool checks below are for you.'));
  console.log(
    fmt.note('If you do want the zero-config path instead of installing tools one by one:'),
  );
  const plan = RECOMMENDED_INSTALL[process.platform as Platform];
  if (plan) {
    console.log(fmt.note(plan.label));
    for (const cmd of plan.commands) {
      console.log(fmt.cmd(cmd));
    }
    console.log(fmt.note('Then: cd aikami && direnv allow — everything comes from flake.nix.'));
  }
  if (recommended.direnv && !recommended.nix) {
    console.log(fmt.note('(You have direnv — you only need nix for the flake path.)'));
  }
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────

const opts = parseCliArgs(Bun.argv.slice(2), {
  check: { type: 'boolean' },
  json: { type: 'boolean' },
  only: { type: 'string' },
});

const platform = process.platform as Platform;
const onlySet = new Set<Category>(
  (opts.only as string | undefined)
    ?.split(',')
    .map((s) => s.trim())
    .filter((s): s is Category => s in CATEGORY_META) ?? [],
);

const selected = onlySet.size > 0 ? TOOLS.filter((t) => onlySet.has(t.category)) : TOOLS;
const applicable = selected.filter((t) => !t.platforms || t.platforms.includes(platform));
const recommended = await probeRecommended();

// Run all checks in parallel.
const results = await Promise.all(
  applicable.map(async (tool): Promise<CheckResult> => {
    const { path, out } = await probe(tool);
    if (!path) {
      return { tool, present: false };
    }
    const ok = tool.verify ? await tool.verify(out) : out.trim().length > 0;
    return {
      tool,
      present: ok,
      version: formatVersion(out),
      detail: ok ? undefined : out.trim().split('\n')[0],
    };
  }),
);

// ── JSON mode ────────────────────────────────────────────────────────────
if (opts.json) {
  const summary = results.map((r) => ({
    name: r.tool.name,
    category: r.tool.category,
    present: r.present,
    version: r.version ?? null,
    why: r.tool.why,
  }));
  console.log(JSON.stringify({ platform, recommended, checks: summary }, null, 2));
  const missingEssential = results.some((r) => !r.present && r.tool.category === 'essentials');
  process.exit(missingEssential ? 1 : 0);
}

// ── Interactive guide ────────────────────────────────────────────────────
console.log(fmt.head('Aikami Local Machine Setup'));
console.log(fmt.note('Checks your machine for the tools needed to work on this repo and'));
console.log(fmt.note('prints install commands for anything missing. This is LOCAL setup —'));
console.log(fmt.note('the GCP cloud project wizard is `bun run project:setup`.'));
console.log(fmt.note(`Platform: ${c.bold}${platform}${c.reset}`));

printRecommendedSection(recommended);

const missingByCategory = new Map<Category, CheckResult[]>();

for (const category of Object.keys(CATEGORY_META) as Category[]) {
  const catResults = results.filter((r) => r.tool.category === category);
  if (catResults.length === 0) {
    continue;
  }

  const meta = CATEGORY_META[category];
  console.log(fmt.section(`${meta.title} — ${meta.desc}`));

  for (const r of catResults) {
    if (r.present) {
      console.log(fmt.ok(`${r.tool.name} ${c.dim}${r.version ?? ''}${c.reset}`));
    } else {
      console.log(fmt.err(`${r.tool.name} — ${r.tool.why}`));
      if (r.tool.hint) {
        console.log(fmt.note(r.tool.hint));
      }
      missingByCategory.set(category, [...(missingByCategory.get(category) ?? []), r]);
    }
  }
}

// ── Install instructions ────────────────────────────────────────────────
const missingCount = [...missingByCategory.values()].flat().length;

if (missingCount === 0) {
  console.log(fmt.head('═══ All checks passed ═══'));
  // Check if essentials were actually evaluated
  const essentialsChecked = results.some((r) => r.tool.category === 'essentials');
  if (essentialsChecked) {
    console.log(`${c.green}${c.bold}Your machine is ready!${c.reset}`);
    console.log(fmt.note('Next: bun install && bun moon sync, then bun run dev'));
  } else {
    console.log(`${c.green}${c.bold}The selected checks passed!${c.reset}`);
    console.log(fmt.note('Note: essential checks were not evaluated (filtered by --only).'));
    console.log(fmt.note('Run without --only to verify your machine is fully ready.'));
  }
  process.exit(0);
}

console.log(fmt.head(`═══ Install these (${missingCount} missing) ═══`));

for (const category of Object.keys(CATEGORY_META) as Category[]) {
  const missing = missingByCategory.get(category) ?? [];
  if (missing.length === 0) {
    continue;
  }

  console.log(`\n${c.bold}${CATEGORY_META[category].title}${c.reset}`);
  for (const r of missing) {
    console.log(`  ${c.cyan}▶ ${r.tool.name}${c.reset}`);
    const plan = r.tool.install[platform];
    if (!plan) {
      console.log(
        fmt.note(`No install recipe for ${platform} — see ${r.tool.hint ?? 'project docs'}`),
      );
      continue;
    }
    console.log(fmt.note(plan.label));
    for (const cmd of plan.commands) {
      console.log(fmt.cmd(cmd));
    }
  }
}

// ── Exit code for --check ────────────────────────────────────────────────
const missingEssential = [...(missingByCategory.get('essentials') ?? [])].length > 0;
if (opts.check) {
  if (missingEssential) {
    console.log(fmt.err('\nEssentials missing — fix and re-run.'));
    process.exit(1);
  }
  console.log(fmt.note('\nEssentials are installed; optional tools are missing (ok for --check).'));
}

console.log(fmt.note('\nTip: with direnv + nix, `direnv allow` provides bun, jdk, chromium,'));
console.log(fmt.note('playwright browsers, tauri deps, gcloud, and herdr from flake.nix —'));
console.log(fmt.note('so most of the checks above become unnecessary.'));
