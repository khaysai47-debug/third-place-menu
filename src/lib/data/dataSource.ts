// Active data-source switches for the dashboard repositories.
//
// SPLIT SWITCH (Phase 2E prep): reads and writes select their source
// independently, because they migrate at different times:
//
// - ACTIVE_READ_SOURCE — FLIPPED to "supabase" 2026-07-06 (Phase 2E), after
//   the flip gate passed: full-coverage parity (orders 38/38 incl. proof,
//   expenses 1/1, strict timestamps) — see docs/adapter-parity-testing.md
//   Run log. ROLLBACK: set it back to "n8n", build, deploy — nothing else.
// - ACTIVE_WRITE_SOURCE — writes MUST stay "n8n" until Phase 2G. The
//   Supabase write methods are throwing stubs, and the n8n automations
//   (notifications, bot replies) trigger off n8n writes. NEVER set this to
//   "supabase" until Supabase writes are implemented, tested, and every
//   downstream automation is re-pointed (runbook Phase 2G, one write at a
//   time).
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

/** Where WRITES go. Stays "n8n" until Phase 2G — read the header first. */
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
