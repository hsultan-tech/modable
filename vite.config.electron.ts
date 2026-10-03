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
    host: '127.0.0.1',
    // Fail rather than drift. Without this Vite quietly takes the next free
    // port when 5174 is busy, and main.ts is told about the new one — while a
    // stale dev server from another project stays sitting on 5174, which is
    // where anything else looking for Modable will land.
    strictPort: true,
    // The renderer talks to server.js for probing, generating and injecting.
    // Without this the Electron dev renderer is served by Vite and every /api
    // call 404s against the dev server instead of reaching the backend.
    // 127.0.0.1, not localhost: that name resolves IPv6-first here.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3456',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})

