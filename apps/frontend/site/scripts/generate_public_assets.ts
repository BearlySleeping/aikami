// apps/frontend/site/scripts/generate_public_assets.ts
/** biome-ignore-all lint/style/useNamingConvention: Material Design token naming convention */

import fs from 'node:fs';
import path from 'node:path';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

import { site } from '../src/lib/data/site_content';

const SOURCE_ICON = 'src/lib/assets/icons/logo.svg';
const PUBLIC_DIR = 'public';
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'site.webmanifest');
const FAVICON_ICO_PATH = path.join(PUBLIC_DIR, 'favicon.ico');
const OG_IMAGE_PATH = path.join(IMAGES_DIR, 'site_image.jpg');

const ICONS = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
] as const;

const generateAssets = async (): Promise<void> => {
  if (!fs.existsSync(SOURCE_ICON)) {
    console.error(`Source icon not found: ${SOURCE_ICON}`);
    console.error('Run scripts/convert_logo_png_to_svg.ts first to generate an SVG logo.');
    process.exit(1);
  }

  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
  for (const icon of ICONS) {
    const destPath = path.join(PUBLIC_DIR, icon.name);
    await sharp(SOURCE_ICON).resize(icon.size, icon.size).toFormat('png').toFile(destPath);
    console.log(`Generated ${icon.name}`);
  }
  try {
    const icoBuffer = await sharp(SOURCE_ICON).resize(256, 256).png().toBuffer();
    const icoFile = await pngToIco(icoBuffer);
    fs.writeFileSync(FAVICON_ICO_PATH, icoFile);
    console.log(`Generated favicon.ico`);
  } catch (_error) {
    console.warn('Failed to generate favicon.ico, continuing...');
  }
  try {
    const background = sharp({
      create: {
        width: 1200,
        height: 630,
        channels: 3,
        background: site.themeColor || '#6d28d9',
      },
    }).png();

    const logoOverlay = await sharp(SOURCE_ICON)
      .resize(300, 300, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    await background
      .composite([{ input: logoOverlay, gravity: 'center' }])
      .toFormat('jpeg')
      .toFile(OG_IMAGE_PATH);
    console.log(`Generated ${OG_IMAGE_PATH}`);
  } catch (_error) {
    console.warn('Failed to generate OG image, continuing...');
  }
  const shortName = site.shortName || site.name;
  const manifest = {
    name: site.name,
    short_name: shortName,
    description: site.description,
    start_url: '/',
    display: 'standalone',
    background_color: site.themeColor,
    theme_color: site.themeColor,
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Generated ${MANIFEST_PATH}`);
};

await generateAssets();
