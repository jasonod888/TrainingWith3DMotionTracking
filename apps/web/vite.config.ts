import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {'/api': 'http://127.0.0.1:8001', '/health': 'http://127.0.0.1:8001'},
  },
  build: {
    manifest: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // The comparison harness is a second entry point. It is deliberately not linked from the
      // app shell, but it ships in the same bundle so it can be opened against the real API.
      input: {
        main: resolve(root, 'index.html'),
        lab: resolve(root, 'avatar-lab.html'),
        // Phase 2 correction-workspace harness: an isolated route that is never linked
        // from the app shell and never part of the review workflow.
        harness: resolve(root, 'workspace-harness.html'),
      },
    },
  },
});
