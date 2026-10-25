import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(fileURLToPath(new URL('./', import.meta.url)), 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // В dev запросы /api уходят на бэкенд; адрес можно переопределить в .env
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
