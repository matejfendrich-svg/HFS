import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Celý build (JS + CSS + data) se vloží inline do jednoho dist/index.html,
// aby šel na macOS otevřít přes file:// bez CORS problémů s ES moduly.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
    outDir: 'dist',
  },
});
