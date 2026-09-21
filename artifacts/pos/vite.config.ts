import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

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

/** Generate the service worker from the actual Rollup output, never guesses. */
const fiscalSafePwaPlugin: Plugin = {
  name: 'pos-generated-service-worker',
  apply: 'build' as const,
  generateBundle(_options, bundle) {
    const assets = Object.values(bundle)
      .map(entry => `${basePath}${entry.fileName}`)
      .filter(url => !url.includes('/api/'));
    const cacheName = `bookie-pos-shell-${Date.now()}`;
    const source = `
const CACHE=${JSON.stringify(cacheName)};
const PRECACHE=${JSON.stringify(assets)};
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));self.skipWaiting();});
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname.includes("/api/")||request.headers.has("authorization")||request.credentials==="include")return;
  if(request.mode==="navigate"){event.respondWith(fetch(request).catch(()=>caches.match(${JSON.stringify(`${basePath}index.html`)})));return;}
  if(PRECACHE.includes(url.pathname))event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});`;
    this.emitFile({ type: 'asset', fileName: 'sw.js', source });
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    rootRedirectPlugin,
    fiscalSafePwaPlugin,
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
    headers: {
      // Prepreči Android Chrome predpomnilnik med razvojem
      'Cache-Control': 'no-store',
    },
    fs: {
      strict: true,
      allow: [
        path.resolve(import.meta.dirname),
        path.resolve(import.meta.dirname, '..', '..', 'fiscal-service', 'contract'),
      ],
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
