// apps/backend/image/scripts/update.ts
// Pulls the latest ComfyUI base image and rebuilds the custom Docker image.

import { $ } from 'bun';

const BASE_IMAGE = 'yanwk/comfyui-boot:cu130-slim-v2';
const CUSTOM_TAG = 'aikami-image:latest';

console.log('🖼️  Updating image service...');

console.log(`📥 Pulling base image: ${BASE_IMAGE}`);
const pullExit = await $`podman pull ${BASE_IMAGE}`.nothrow();
if (pullExit.exitCode !== 0) {
  console.error('❌ Failed to pull base image.');
  process.exit(1);
}
console.log('✅ Base image pulled.');

console.log(`🔨 Building custom image: ${CUSTOM_TAG}`);
const buildExit = await $`podman build -t ${CUSTOM_TAG} --pull .`.nothrow();
if (buildExit.exitCode !== 0) {
  console.error('❌ Build failed.');
  process.exit(1);
}

console.log('✅ Image service updated.');
