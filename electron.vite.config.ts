import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    // zod is bundled into the main output so it does not need to ship in node_modules
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
    resolve: {
      alias: { '@shared': shared, '@main': resolve(__dirname, 'src/main') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          networkDiscoverWorker: resolve(__dirname, 'src/main/fs/networkDiscoverWorker.ts'),
          shellIconWorker: resolve(__dirname, 'src/main/icons/shellIconWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared }
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { '@shared': shared, '@renderer': resolve(__dirname, 'src/renderer') }
    },
    optimizeDeps: {
      exclude: ['onnxruntime-web']
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          compiledLists: resolve(__dirname, 'src/renderer/compiledLists.html')
        },
        output: {
          manualChunks(id) {
            if (id.includes('onnxruntime-web')) return 'ort'
          }
        }
      }
    }
  }
})
