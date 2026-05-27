#!/usr/bin/env node
import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

await build({
  root: resolve(root, 'src/dashboard'),
  build: {
    outDir: resolve(root, 'dist/dashboard'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, 'src/dashboard/index.html'),
    },
  },
  optimizeDeps: {
    include: ['source-map'],
  },
  publicDir: false,
});
console.log('dashboard built');
