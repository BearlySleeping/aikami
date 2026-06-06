// scripts/generate-public-assets.ts
/** biome-ignore-all lint/style/useNamingConvention: Material Design token naming convention */

import fs from 'node:fs';
import path from 'node:path';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

import { site } from '../src/lib/data/site_content';

const SOURCE_ICON = 'src/lib/assets/icons/logo.svg';
const PUBLIC_DIR = 'public';
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images'); // Ensure this folder exists
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'site.webmanifest');
const FAVICON_ICO_PATH = path.join(PUBLIC_DIR, 'favicon.ico');
const OG_IMAGE_PATH = path.join(IMAGES_DIR, 'site_image.jpg');

const ICONS = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

const generateAssets = async () => {
  if (!fs.existsSync(SOURCE_ICON)) {
    throw new Error('Source icon not found');
  }

  // Ensure /public/images exists
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
  for (const icon of ICONS) {
    const destPath = path.join(PUBLIC_DIR, icon.name);
    await sharp(SOURCE_ICON).resize(icon.size, icon.size).toFormat('png').toFile(destPath);
  }
  try {
    const icoBuffer = await sharp(SOURCE_ICON).resize(256, 256).png().toBuffer();
    const icoFile = await pngToIco(icoBuffer);
    fs.writeFileSync(FAVICON_ICO_PATH, icoFile);
  } catch (_error) {}
  try {
    // Create a background with your theme color
    const background = sharp({
      create: {
        width: 1200,
        height: 630,
        channels: 3,
        background: site.themeColor || '#1e293b',
      },
    }).png();

    // Resize your logo to sit in the center (300px wide)
    const logoOverlay = await sharp(SOURCE_ICON)
      .resize(300, 300, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    // Composite them
    await background
      .composite([{ input: logoOverlay, gravity: 'center' }])
      .toFormat('jpeg')
      .toFile(OG_IMAGE_PATH);
  } catch (_error) {}
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
};

await generateAssets();
