import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['ws']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart({ reload }) {
          reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    electronRenderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5174,
    host: '127.0.0.1'
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})

