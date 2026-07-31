// scripts/src/lib/ops/generate_brand_assets.ts
// Generates favicons, PWA icons, OG images, and webmanifest for all frontends
// from the canonical root assets/logo.png.
//
// Usage: bun run scripts/src/lib/ops/generate_brand_assets.ts [--skip-svg]
//   --skip-svg   Skip the imagetracerjs PNG→SVG conversion (faster iteration)

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dir, '../../../..');
const SOURCE_LOGO = path.join(ROOT, 'assets/logo.png');
const SOURCE_SVG = path.join(ROOT, 'assets/logo.svg');

interface FrontendTarget {
  /** Human-readable name */
  name: string;
  /** Public/static directory where assets are placed */
  publicDir: string;
  /** Subdirectory within publicDir for images (e.g. 'images' or '') */
  imagesSubdir: string;
}

const TARGETS: FrontendTarget[] = [
  {
    name: 'client',
    publicDir: path.join(ROOT, 'apps/frontend/client/static'),
    imagesSubdir: '',
  },
  {
    name: 'site',
    publicDir: path.join(ROOT, 'apps/frontend/site/public'),
    imagesSubdir: 'images',
  },
  {
    name: 'docs',
    publicDir: path.join(ROOT, 'apps/frontend/docs/public'),
    imagesSubdir: '',
  },
];

// ---------------------------------------------------------------------------
// Branding (editable — keep in sync with site_content.ts)
// ---------------------------------------------------------------------------

interface Branding {
  name: string;
  shortName: string;
  description: string;
  themeColor: string;
  backgroundColor: string;
}

const BRANDING: Branding = {
  name: 'Aikami',
  shortName: 'Aikami',
  description:
    'Aikami is a free, open-source, self-hosted AI-native 2D RPG engine. Every NPC thinks, remembers, and adapts — driven by local AI models you control.',
  themeColor: '#6d28d9',
  backgroundColor: '#6d28d9',
};

// ---------------------------------------------------------------------------
// Icon sizes to generate
// ---------------------------------------------------------------------------

interface IconSpec {
  name: string;
  size: number;
}

const ICONS: IconSpec[] = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ensureDir = (dir: string): void => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Step 1 — Convert PNG → SVG (if needed)
// ---------------------------------------------------------------------------

const convertPngToSvg = async (skipSvg: boolean): Promise<void> => {
  if (skipSvg) {
    if (fs.existsSync(SOURCE_SVG)) {
      console.log(dim('Skipping SVG conversion (--skip-svg, existing SVG found)'));
      return;
    }
    console.warn('⚠  --skip-svg passed but no SVG exists; converting anyway');
  }

  console.log(`Tracing ${SOURCE_LOGO} → ${SOURCE_SVG} ...`);
  const convertScript = path.join(import.meta.dir, 'convert_logo_png_to_svg.ts');
  execSync(`bun run "${convertScript}" --input "${SOURCE_LOGO}" --output "${SOURCE_SVG}"`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  console.log(green('✓ SVG conversion complete'));
};

// ---------------------------------------------------------------------------
// Step 2 — Generate all raster assets for a single frontend target
// ---------------------------------------------------------------------------

const generateForTarget = async (target: FrontendTarget): Promise<void> => {
  const publicDir = target.publicDir;
  const imagesDir = target.imagesSubdir ? path.join(publicDir, target.imagesSubdir) : publicDir;

  ensureDir(publicDir);
  ensureDir(imagesDir);

  console.log(`\n${dim('───')} ${target.name} ${dim('→')} ${path.relative(ROOT, publicDir)}`);

  // --- PNG icons ---
  for (const icon of ICONS) {
    const destPath = path.join(publicDir, icon.name);
    await sharp(SOURCE_LOGO)
      .resize(icon.size, icon.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(destPath);
    console.log(`  ${green('✓')} ${icon.name}`);
  }

  // --- favicon.ico (multi-size: 16, 32, 48) ---
  try {
    const sizes = [16, 32, 48];
    const pngBuffers = await Promise.all(
      sizes.map((s) =>
        sharp(SOURCE_LOGO)
          .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer(),
      ),
    );
    const icoBuffer = await pngToIco(pngBuffers);
    const icoPath = path.join(publicDir, 'favicon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`  ${green('✓')} favicon.ico (16+32+48)`);
  } catch (err) {
    console.warn(`  ⚠  favicon.ico generation failed:`, (err as Error).message);
  }

  // --- favicon.svg ---
  if (fs.existsSync(SOURCE_SVG)) {
    const svgDest = path.join(publicDir, 'favicon.svg');
    fs.copyFileSync(SOURCE_SVG, svgDest);
    console.log(`  ${green('✓')} favicon.svg`);
  }

  // --- Open Graph image (1200×630) ---
  try {
    const ogPath = path.join(imagesDir, 'og-image.jpg');
    const logoOverlay = await sharp(SOURCE_LOGO)
      .resize(400, 400, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    await sharp({
      create: {
        width: 1200,
        height: 630,
        channels: 3,
        background: BRANDING.themeColor,
      },
    })
      .composite([{ input: logoOverlay, gravity: 'center' }])
      .jpeg({ quality: 85 })
      .toFile(ogPath);
    console.log(`  ${green('✓')} og-image.jpg`);
  } catch (err) {
    console.warn(`  ⚠  OG image generation failed:`, (err as Error).message);
  }

  // --- Web manifest ---
  const manifest = {
    name: BRANDING.name,
    short_name: BRANDING.shortName,
    description: BRANDING.description,
    start_url: '/',
    display: 'standalone' as const,
    background_color: BRANDING.backgroundColor,
    theme_color: BRANDING.themeColor,
    orientation: 'portrait' as const,
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  };
  const manifestPath = path.join(publicDir, 'site.webmanifest');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  ${green('✓')} site.webmanifest`);

  // --- Summary ---
  const generatedFiles = [
    ...ICONS.map((i) => i.name),
    'favicon.ico',
    'favicon.svg',
    'site.webmanifest',
    path.join(target.imagesSubdir || '.', 'og-image.jpg'),
  ];
  console.log(`  ${dim(`(${generatedFiles.length} files generated)`)}`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const skipSvg = args.includes('--skip-svg');

  if (!fs.existsSync(SOURCE_LOGO)) {
    console.error(`Source logo not found: ${SOURCE_LOGO}`);
    console.error('Place your logo at assets/logo.png and re-run.');
    process.exit(1);
  }

  console.log(`${dim('Source:')} ${path.relative(ROOT, SOURCE_LOGO)} (${(fs.statSync(SOURCE_LOGO).size / 1024).toFixed(0)} KB)`);

  // Step 1: PNG → SVG
  await convertPngToSvg(skipSvg);

  // Step 2: Generate for each frontend
  for (const target of TARGETS) {
    await generateForTarget(target);
  }

  console.log(`\n${green('✔ All brand assets generated')}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
