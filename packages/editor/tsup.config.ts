import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2020',
  dts: true,
  sourcemap: true,
  clean: true,
  // React and the core types stay with the app.
  external: ['react', 'react-dom', '@lacijs/core'],
  tsconfig: 'tsconfig.build.json',
});
