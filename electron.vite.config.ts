import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const root = resolve(import.meta.dirname, 'app-electron')

export default defineConfig({
  main: {
    build: {
      outDir: resolve(root, 'out/main'),
      rollupOptions: {
        external: ['electron', 'electron-updater', 'sharp', '@resvg/resvg-js', 'get-windows', 'koffi', 'tesseract.js', '@tesseract.js-data/eng'],
        input: {
          index: resolve(root, 'src/main/index.ts'),
          'uia-worker': resolve(root, 'src/main/uia-worker.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    build: {
      outDir: resolve(root, 'out/preload'),
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(root, 'src/preload/index.ts'),
          capture: resolve(root, 'src/preload/capture.ts'),
          picker: resolve(root, 'src/preload/picker.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: resolve(root, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html'),
          capture: resolve(root, 'src/renderer/capture.html'),
          picker: resolve(root, 'src/renderer/picker.html'),
        },
      },
    },
  },
})
