// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Prerender the HTML shell so Vercel can serve this as a static SPA.
    // All data is fetched client-side from n8n, so no SSR is needed at request time.
    spa: { enabled: true },
  },
  // Phase 2G-D2: emit .vercel/output (Build Output API) so Vercel deploys the
  // Nitro server function — required for the /api/staff/* server routes.
  // Without this the deploy plugin is skipped outside Lovable sandboxes and
  // production is static-only (no server, /api/* unreachable).
  nitro: { preset: "vercel" },
});
