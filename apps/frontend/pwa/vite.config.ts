import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig, type PluginOption } from 'vite'
import devtoolsJson from 'vite-plugin-devtools-json'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isoImport } from 'vite-plugin-iso-import'
import { visualizer } from 'rollup-plugin-visualizer'
import process from 'node:process'

const projectDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(projectDirectory, '../../..')

const port = Number(process.env.PORT || 5173)

export default defineConfig(({ mode }) => {
  const plugins: PluginOption[] = [
    isoImport(),
    tailwindcss(),
    sveltekit(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
    }) as PluginOption,
  ]

  if (mode === 'development' && process.env['DEBUG'] === '1') {
    plugins.unshift(devtoolsJson())
  }

  if (mode === 'analyze') {
    plugins.push(
      visualizer({
        brotliSize: true,
        filename: 'dist/stats.html',
        gzipSize: true,
        open: true,
      }) as unknown as PluginOption,
    )
  }

  return {
    plugins,
    envPrefix: ['PUBLIC_'],

    server: {
      fs: {
        allow: [rootDirectory],
      },
      port,
    },
  }
})
