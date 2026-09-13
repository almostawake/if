import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      '/consent': 'http://localhost:5001/demo-not-required/australia-southeast1/api',
      '/oauth': 'http://localhost:5001/demo-not-required/australia-southeast1/api',
    },
  },
});
