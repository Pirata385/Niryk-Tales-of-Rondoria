import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode single` produces one self-contained index.html (assets inlined) that can be
// shared as a single page; the default build is a normal multi-file site (GitHub Pages).
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
        '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
      },
    },
    define: { __SINGLE_FILE__: JSON.stringify(single) },
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      assetsInlineLimit: single ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 4000,
    },
    server: { host: true },
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  };
});
