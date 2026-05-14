import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true
    }),
    // `$common` resolves to functions/src/common — the single home for
    // browser-safe code shared between client and functions: zod schemas
    // for Firestore-backed types, plus their inferred TS types (see
    // ../docs/CLAUDE-STACK.md). Files there must stay browser-safe (no
    // firebase-admin / Node-only imports) so this client bundle works.
    alias: {
      $common: '../functions/src/common'
    }
  }
};
