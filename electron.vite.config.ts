import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
        formats: ['cjs']
      },
      rollupOptions: {
        external: ['electron', 'electron-store', 'electron-log', 'node-fetch']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        formats: ['cjs']
      },
      rollupOptions: {
        external: ['electron']
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'resources/index.html'),
          overlay: resolve(__dirname, 'resources/overlay.html')
        }
      }
    }
  }
})
