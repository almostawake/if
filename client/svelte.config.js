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
    // `$types` resolves to functions/src/types — the single home for
    // Firestore-backed types (see ../docs/CLAUDE-STACK.md). Files there
    // must stay browser-safe (pure types or zod schemas, no
    // firebase-admin / Node-only imports) so this client bundle works.
    alias: {
      $types: '../functions/src/types'
    }
  }
};
