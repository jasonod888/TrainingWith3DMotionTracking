import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));

// Isolated UI-L0 spike build. Deliberately separate from the application entries so the
// measured comparison chunks do not affect the shipped bundle.
export default defineConfig({
  root,
  build: {
    outDir: '.spike-dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: resolve(root, 'spike.html'),
      output: {manualChunks(id) {
        if (id.includes('react-piano')) return 'lib-react-piano';
        if (id.includes('fretboard.js')) return 'lib-fretboard';
        if (id.includes('svguitar') || id.includes('@svgdotjs') || id.includes('roughjs') || id.includes('svgdom')) return 'lib-svguitar';
        if (id.includes('d3-') || id.includes('tonal') || id.includes('change-case') || id.includes('throttle-debounce')) return 'lib-guitar-deps';
        if (id.includes('node_modules/react') || id.includes('scheduler')) return 'lib-react';
        return undefined;
      }},
    },
  },
});
