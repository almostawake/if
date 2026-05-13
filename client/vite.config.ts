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
    fs: { allow: ['..'] },
    // Public browser-facing OAuth routes live on the `api` function. In prod,
    // Firebase Hosting rewrites do this same forwarding. Keeps the URL the
    // user sees identical in dev and prod (e.g. http://localhost:5173/consent
    // ↔ https://<project>.web.app/consent).
    proxy: {
      '/consent': 'http://localhost:5001/demo-not-required/australia-southeast1/api',
      '/oauth': 'http://localhost:5001/demo-not-required/australia-southeast1/api'
    }
  }
});
