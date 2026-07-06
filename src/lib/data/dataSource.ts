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
// SAFETY: "supabase" selects adapters whose READS are implemented (Phase 2C)
// but whose WRITES still throw AdapterNotImplementedError until Phase 2G — so
// a premature flip breaks every staff action loudly instead of silently
// bypassing the n8n automations. Do not flip before parity passes (Phase 2D,
// docs/adapter-parity-testing.md).

export type DataSource = "n8n" | "supabase";

export const ACTIVE_DATA_SOURCE: DataSource = "n8n";
