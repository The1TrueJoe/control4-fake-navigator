import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies the backend (websocket + REST) so the UI runs at :5173
// while the Rust backend serves data at :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/api': 'http://localhost:8080',
    },
  },
  build: { outDir: 'dist' },
})
