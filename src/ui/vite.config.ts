import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// UI on 127.0.0.1:3210; backend API proxied from 127.0.0.1:8000 (see AGENTS.md §3)
// NOTE: port 3000 is occupied by another service on this machine — 3210 is the UI port.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3210,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
