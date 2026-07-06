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
