// Central base URL for all n8n webhook calls.
//
// DATA BOUNDARY (see docs/backend-separation-map.md): n8n was the temporary MVP
// bridge for every dashboard read/write. Since the Phase 2E–2G-I flips the live
// paths run on Supabase (reads, staff writes, menu availability, order intake);
// the n8nWebhook() calls that remain in the src/lib data modules are the
// untouched one-line rollback paths selected by the dataSource.ts source
// switches. Separately, n8n keeps automation only (IG/Messenger bot, payment
// proof, notifications). UI code must never call n8nWebhook directly; only the
// src/lib data modules (orders, staffOrders, expenses, menuAvailability) do.
//
// Defaults to localhost for local Mac testing (n8n running on the same
// machine). To test from another device on the LAN (e.g. iPhone), set
// VITE_N8N_BASE_URL in a .env.local file and restart the dev server, e.g.:
//
//   VITE_N8N_BASE_URL=http://192.168.1.103:5678
//
// This is a PUBLIC URL, not a secret — see the .server.ts note about
// import.meta.env.VITE_* config that is safe to ship to the browser.
const N8N_BASE_URL = import.meta.env.VITE_N8N_BASE_URL ?? "http://localhost:5678";

/** Build a full n8n webhook URL from its path slug (without leading slash). */
export function n8nWebhook(slug: string): string {
  return `${N8N_BASE_URL}/webhook/${slug}`;
}
