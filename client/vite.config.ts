import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { projectRegion } from '../cmd-region.mjs';
import { version } from './package.json';

// The Functions emulator serves at /<project>/<region>/<function>, in the
// same region the deploy uses (root .env → cmd-region.mjs). Read once here;
// never spell a region out in this file.
const EMULATOR_API = `http://localhost:5001/demo-not-required/${projectRegion()}/api`;

// Build id, stamped twice from this one value: compiled into the bundle as
// `__BUILD_ID__` (define below) and written to dist/version.json (plugin
// below). src/version.ts compares the two at runtime to notice a newer
// deploy. A timestamp rather than a git sha, so every build — even one with
// no new commits — counts as new.
const BUILD_ID = new Date().toISOString();

function versionJson(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: BUILD_ID }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionJson()],
  // The version shows at the bottom of the app menu, so a tester can tell
  // which build they are on.
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      // `@` is the client's own src. This spelling (not `$lib`) is what
      // shadcn/ui's CLI and the wider React ecosystem assume, so generated
      // components drop in without rewriting imports.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `@common` resolves to functions/src/common — the single home for
      // browser-safe code shared between client and functions: zod schemas
      // for Firestore-backed types, plus their inferred TS types (see
      // ../docs/CLAUDE-STACK.md). Files there must stay browser-safe (no
      // firebase-admin / Node-only imports) so this client bundle works.
      '@common': fileURLToPath(new URL('../functions/src/common', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Allow Vite to read source files outside `client/` — the `@common`
    // alias points at `../functions/src/common`. Without this, dev hits
    // a 403 from Vite's fs sandbox the first time the alias resolves.
    fs: { allow: ['..'] },
    // Public browser-facing OAuth routes live on the `api` function. In prod,
    // Firebase Hosting rewrites do this same forwarding. Keeps the URL the
    // user sees identical in dev and prod (e.g. http://localhost:5173/consent
    // ↔ https://<project>.web.app/consent).
    proxy: {
      '/consent': EMULATOR_API,
      '/oauth': EMULATOR_API,
    },
  },
});
