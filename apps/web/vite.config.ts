import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The Worker serves this directory as static assets. See apps/worker/wrangler.jsonc.
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
