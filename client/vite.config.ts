import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    // Allow Vite to read source files outside `client/` — the `$types`
    // alias points at `../functions/src/types`. Without this, dev hits
    // a 403 from Vite's fs sandbox the first time the alias resolves.
    fs: { allow: ['..'] }
  }
});
