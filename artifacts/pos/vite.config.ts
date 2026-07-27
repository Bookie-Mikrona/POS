import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// Plugin ki ujame VSE requests brez /pos/ prefiksa in jih preusmeri na /pos/.
// Clerk med sign-out procesira navigacijo na poti kot /sign-in, /clerk-sync itd.
// ki nimajo /pos/ prefiksa — Vite 7 base middleware jih vrne z "did you mean /pos/?"
const rootRedirectPlugin = {
  name: 'pos-root-redirect',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? '/';
      // Preskoči WebSocket upgrade in Vite interne poti (začnejo z /@)
      if (url.startsWith(basePath) || url.startsWith('/@') || url.startsWith('/node_modules')) {
        return next();
      }
      // Vse ostale poti brez /pos/ → preusmeri na /pos/
      res.writeHead(302, { Location: basePath });
      res.end();
    });
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    rootRedirectPlugin,
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      // Posreduj /pos/api/... → API strežnik na :8080 kot /api/...
      // Brez tega nginx usmeri /pos/* na POS Vite, ki vrne index.html za vse API klice
      '/pos/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/pos/, ''),
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
