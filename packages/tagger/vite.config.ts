import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'RldTagger',
      formats: ['iife'],
      fileName: () => 'tagger.js',
    },
    minify: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
