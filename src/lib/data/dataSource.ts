// Active data-source switches for the dashboard repositories.
//
// SPLIT SWITCH (Phase 2E prep): reads and writes select their source
// independently, because they migrate at different times:
//
// - ACTIVE_READ_SOURCE — FLIPPED to "supabase" 2026-07-06 (Phase 2E), after
//   the flip gate passed: full-coverage parity (orders 38/38 incl. proof,
//   expenses 1/1, strict timestamps) — see docs/adapter-parity-testing.md
//   Run log. ROLLBACK: set it back to "n8n", build, deploy — nothing else.
// - ACTIVE_WRITE_SOURCE — historical umbrella switch; every real write now
//   has its own targeted switch below (STAFF_ACTION_WRITE_SOURCE,
//   MENU_AVAILABILITY_SOURCE, ORDER_INTAKE_SOURCE). Stays "n8n": the
//   repository's Supabase submitOrder is a throwing stub and nothing else
//   follows it.
//
// Deliberately constants, NOT environment variables — production cannot
// drift to an unimplemented adapter through config; every flip is a reviewed
// one-line code change.
//
// Rollback for any flip: set the flag back to "n8n" and redeploy. The n8n
// adapters are never modified during migration (runbook § Rollback plan).

export type DataSource = "n8n" | "supabase";

/** Where dashboard READS come from. Supabase since Phase 2E (2026-07-06). */
export const ACTIVE_READ_SOURCE: DataSource = "supabase";

/**
 * Where repository-level WRITES go. As of 2G-I this governs NOTHING in
 * practice: staff actions follow STAFF_ACTION_WRITE_SOURCE, order intake
 * follows ORDER_INTAKE_SOURCE, and no UI calls the repository's submitOrder.
 * Kept as the documented default for any future repository write.
 */
export const ACTIVE_WRITE_SOURCE: DataSource = "n8n";

/**
 * TARGETED staff-action write switch (Phase 2G-F, flipped 2026-07-08) for
 * exactly four staff actions: order status update, cancel, mark-paid, and
 * add-expense. "supabase" routes them through the app's own /api/staff/*
 * server routes (validated 2G-E on production). Deliberately separate from
 * ACTIVE_WRITE_SOURCE because submitOrder (customer checkout + manual order)
 * MUST stay on n8n until its own phase — the Supabase submitOrder is a
 * throwing stub.
 * ROLLBACK: set this back to "n8n", build, deploy — staff actions return to
 * the untouched n8n webhooks. Staff devices need the write secret (⚿ on the
 * staff page) while this is "supabase".
 */
export const STAFF_ACTION_WRITE_SOURCE: DataSource = "supabase";

/**
 * MENU AVAILABILITY source switch (Phase 2G-H) — governs BOTH the menu
 * availability read (customer menu, staff Menu board, manual-order picker)
 * and the staff availability write. Read and write flip TOGETHER on purpose:
 * a Supabase write with an n8n read (or vice versa) would let
 * availability_status and is_available drift apart mid-transition.
 * "supabase" = anon-key read of menu_items + writes via the
 * /api/staff/update-menu-availability server route (dual-writes
 * availability_status + is_available).
 * DEPLOYMENT ORDER: run docs/sql/2026-07-14-2G-H-menu-availability-status.sql
 * in the Supabase SQL editor BEFORE deploying with this set to "supabase" —
 * the write route PATCHes the new column and fails (safely) without it.
 * ROLLBACK: set back to "n8n", build, deploy — the n8n menu webhooks are
 * untouched. NOTE: n8n only writes is_available, so availability_status goes
 * stale during a rollback; re-run the backfill UPDATE (in the same SQL file)
 * before flipping forward again.
 */
export const MENU_AVAILABILITY_SOURCE: DataSource = "supabase";

/**
 * ORDER INTAKE source switch (Phase 2G-I) — governs ONLY customer checkout
 * and Staff Add Order (submitOrder in src/lib/orders.ts; both call it
 * directly, not via the repository). "supabase" sends intake to the app's
 * own secure server routes (/api/order/submit public, /api/staff/add-order
 * with x-staff-secret), which call the create_order_with_items RPC — the
 * server recomputes ALL prices/totals from menu_items and generates the
 * order number; client money fields are never trusted.
 * DEPLOYMENT ORDER: run docs/sql/2026-07-14-2G-I-order-intake.sql in the
 * Supabase SQL editor BEFORE deploying with this set to "supabase" — the
 * routes call the RPC and fail (safely, no data written) without it.
 * ROLLBACK: set back to "n8n", build, deploy — intake returns to the
 * untouched third-place-order-test webhook (which does its own inserts).
 * ⚠️ The old intake webhook INSERTS orders — never call it in addition to
 * the Supabase path or every order is duplicated (see
 * docs/n8n-workflow-side-effects.md row 1).
 */
export const ORDER_INTAKE_SOURCE: DataSource = "supabase";
