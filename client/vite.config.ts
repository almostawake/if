import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { version } from './package.json';
import { projectRegion } from '../cmd-region.mjs';

// Build id, stamped twice from this one value: compiled into the bundle as
// `__BUILD_ID__` (define below) and written to dist/version.json (plugin
// below). src/version.ts compares the two at runtime to notice a newer
// deploy. A timestamp rather than a git sha, so every build — even one with
// no new commits — counts as new.
const BUILD_ID = new Date().toISOString();

// The region callables are reached in, from root .env via the one reader
// (cmd-region.mjs). A build with no region stops here on purpose; the dev
// server tolerates a missing .env because the emulator ignores regions.
function functionsRegion(isBuild: boolean): string {
  try {
    return projectRegion();
  } catch (e) {
    if (isBuild) throw e;
    return 'emulator';
  }
}

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

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), versionJson()],
  // The version shows at the bottom of the app menu, so a tester can tell
  // which build they are on.
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __APP_VERSION__: JSON.stringify(version),
    __FUNCTIONS_REGION__: JSON.stringify(functionsRegion(command === 'build')),
  },
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
  },
}));
