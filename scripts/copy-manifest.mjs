import { copyFileSync, cpSync, mkdirSync } from 'node:fs';

// Copia a dist/ los estaticos que Vite no empaqueta: manifest e iconos.
// Las rutas del manifest son relativas a dist/ (plano).
mkdirSync('dist', { recursive: true });
copyFileSync('src/manifest.json', 'dist/manifest.json');
cpSync('src/icons', 'dist/icons', { recursive: true });
console.log('manifest.json e icons/ copiados a dist/');
