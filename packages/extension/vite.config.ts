import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        'content-bridge': resolve(__dirname, 'src/content-bridge.ts'),
        devtools: resolve(__dirname, 'src/devtools.ts'),
        panel: resolve(__dirname, 'src/panel.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        format: 'es',
      },
    },
  },
  plugins: [
    {
      name: 'copy-static',
      closeBundle() {
        const dist = resolve(__dirname, 'dist');
        mkdirSync(dist, { recursive: true });
        copyFileSync(resolve(__dirname, 'src/manifest.json'), resolve(dist, 'manifest.json'));
        copyFileSync(resolve(__dirname, 'devtools.html'), resolve(dist, 'devtools.html'));
        copyFileSync(resolve(__dirname, 'panel.html'), resolve(dist, 'panel.html'));
        copyFileSync(resolve(__dirname, 'panel.css'), resolve(dist, 'panel.css'));
        copyFileSync(resolve(__dirname, '../tagger/dist/tagger.js'), resolve(dist, 'tagger.js'));
      },
    },
  ],
});
