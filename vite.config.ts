import { defineConfig } from 'vite';

// Vercel serves the app at the root. GitHub Pages serves it at /nesmo/, so
// the Pages workflow builds with BASE_PATH=/nesmo/.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
  },
});
