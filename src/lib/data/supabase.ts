// Minimal Supabase PostgREST READ client (Phase 2C — reads only).
//
// Since the Pre-Pilot Security Hardening phase this is used ONLY for the
// PUBLIC menu_items read (column-limited anon grant, 2G-H) — the menu is
// public-by-nature data. Dashboard reads of sensitive tables (orders,
// order_items, payment_proofs, expenses) go through the protected
// /api/staff/* routes (staffReadClient.ts); never add a sensitive-table
// read here.
//
// Deliberately NOT @supabase/supabase-js: the read path is two SELECTs over
// Supabase's REST API, which plain fetch covers without a new dependency or
// module-init side effects.
// ponytail: plain fetch; adopt supabase-js when Phase 2G writes/auth/realtime demand it.
//
// ENV (frontend-safe, set in .env.local — values are NEVER committed):
//   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon public key — NEVER the service_role key>
//
// Env is read lazily inside the request, so importing this module — and
// building/running the app — without Supabase env stays safe while
// ACTIVE_READ_SOURCE is "n8n". Calling it without env throws a clear
// developer error. Reads THROW on failure (repository contract: the UI has
// retry states for reads).

import { supabaseAuthHeaders } from "../../../api/_lib/supabaseAuth";

export async function supabaseSelect<T>(table: string, query: string): Promise<T[]> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in " +
        '.env.local (anon key only — never service_role). ACTIVE_READ_SOURCE stays "n8n" ' +
        "until Phase 2E, so the live app is unaffected.",
    );
  }
  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${table}?${query}`, {
    headers: supabaseAuthHeaders(key),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Supabase read failed: ${table} responded ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Supabase read returned an unexpected shape for ${table}`);
  }
  return data as T[];
}
