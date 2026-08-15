import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      // ws: true is MANDATORY. Without it the WebSocket upgrade request 404s
      // and Socket.IO silently falls back to long-polling — which "works",
      // badly, at maybe 3 fps. That failure mode is subtle enough to waste an
      // afternoon.
      '/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
    },
  },
})
