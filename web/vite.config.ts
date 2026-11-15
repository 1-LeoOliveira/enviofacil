import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const alvoApi = process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: alvoApi, changeOrigin: true },
      '/socket.io': { target: alvoApi, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
