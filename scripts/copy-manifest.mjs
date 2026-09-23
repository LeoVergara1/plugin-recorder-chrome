import { copyFileSync, mkdirSync } from 'node:fs';

// Copia el manifest fuente a dist/ tras `vite build`.
// Las rutas del manifest son relativas a dist/ (plano).
mkdirSync('dist', { recursive: true });
copyFileSync('src/manifest.json', 'dist/manifest.json');
console.log('manifest.json copiado a dist/');
