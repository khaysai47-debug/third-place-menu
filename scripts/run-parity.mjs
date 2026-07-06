// Phase 2D parity runner for Node — dev tool, never part of any bundle.
//
// Why this exists: the browser console runner (src/lib/data/dev/runParity.ts)
// hits n8n Cloud's CORS policy from localhost. Node has no CORS, so this
// script loads THE SAME runner module through Vite's SSR module loader —
// real adapters, real mappers, `@/` aliases and import.meta.env (.env.local,
// values never printed) all resolved by Vite — and runs it here.
// No new dependency: vite and vite-tsconfig-paths are already installed.
//
// Usage:
//   npm run parity            (presence-mode timestamps)
//   npm run parity -- --strict   (strict timestamp value comparison)
//
// Exit code 0 = parity OK for both domains; 1 = mismatches or fetch failures.
// ACTIVE_READ_SOURCE / ACTIVE_WRITE_SOURCE are untouched — this calls the
// inactive Supabase adapter directly, which is the whole point
// (docs/adapter-parity-testing.md).

import { createServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// configFile:false keeps the TanStack Start/nitro dev plugins out of the
// loop — parity only needs module resolution + env, not the app server.
const server = await createServer({
  configFile: false,
  plugins: [tsconfigPaths()],
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true },
});

try {
  const mod = await server.ssrLoadModule("/src/lib/data/dev/runParity.ts");
  const strict = process.argv.includes("--strict");
  const run = await mod.runAdapterParity({ strictTimestamps: strict });

  const fetchFailures = Object.keys(run.fetchErrors).length > 0;
  const ok = !fetchFailures && run.orders?.ok === true && run.expenses?.ok === true;
  console.log(
    ok
      ? "\n[parity] PASS — both domains match" + (strict ? " (strict timestamps)" : "")
      : "\n[parity] FAIL — see lines above; do not flip reads",
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  await server.close();
}
