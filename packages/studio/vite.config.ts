import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The studio UI: a single page served by the studio server. Relative URLs (`base: './'`) let it
// work wherever the studio is mounted.
export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@lacijs\/editor$/, replacement: source('../editor/src/index.ts') },
      { find: /^@lacijs\/editor\/style\.css$/, replacement: source('../editor/src/styles.css') },
    ],
  },
  build: { outDir: '../dist/ui', emptyOutDir: true, chunkSizeWarningLimit: 700 },
});
