import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, 'src');

// root=src para que los HTML salgan planos en dist/ (popup.html,
// offscreen.html, viewer.html), tal como los referencia el manifest.
export default defineConfig({
  root: src,
  plugins: [react()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(src, 'popup.html'),
        offscreen: resolve(src, 'offscreen.html'),
        viewer: resolve(src, 'viewer.html'),
        options: resolve(src, 'options.html'),
        background: resolve(src, 'background/service-worker.ts'),
        content: resolve(src, 'content/tab-detector.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background/service-worker.js';
          if (chunk.name === 'content') return 'content/tab-detector.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
