// Active data-source switch for the dashboard repositories.
//
// HOW THE PHASE 2 SWITCH WILL WORK
// 1. Implement supabaseOrdersAdapter / supabaseExpensesAdapter for real.
// 2. Flip ACTIVE_DATA_SOURCE below to "supabase" (a code change reviewed like
//    any other — deliberately NOT an environment variable yet, so production
//    cannot drift to an unimplemented adapter through config).
// 3. Verify against the regression checklist in docs/backend-separation-map.md.
// 4. Later, retire the n8n adapters and this switch entirely.
//
// The switch can also be flipped per-domain (orders before expenses) by
// splitting this constant when Phase 2 actually starts — keep it one value
// until then.
//
// SAFETY: "supabase" currently selects stub adapters whose every method throws
// AdapterNotImplementedError, so a premature flip fails loudly on first data
// access rather than corrupting anything.

export type DataSource = "n8n" | "supabase";

export const ACTIVE_DATA_SOURCE: DataSource = "n8n";
