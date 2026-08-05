import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3050,
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR !== 'true',
      // Dev-mode Express API server runs on 3001 (see server/index.js:
      // PORT = isProduction ? ... : 3001). Vite itself owns 3050, so
      // proxying /api to 3050 was routing API calls back into Vite's own
      // dev server instead of the Express backend.
      proxy: {
        '/api': 'http://localhost:3001',
      },
    },
  };
});
