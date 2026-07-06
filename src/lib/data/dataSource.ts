// Active data-source switches for the dashboard repositories.
//
// SPLIT SWITCH (Phase 2E prep): reads and writes select their source
// independently, because they migrate at different times:
//
// - ACTIVE_READ_SOURCE — reads CAN flip first: set it to "supabase" in
//   Phase 2E, but only after the flip gate in
//   docs/backend-separation-runbook.md is fully checked (parity on ≥2 days,
//   real-expense day, proof order, checklist walk, RLS review).
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

/** Where dashboard READS come from. May flip in Phase 2E — after the gate. */
export const ACTIVE_READ_SOURCE: DataSource = "n8n";

/** Where WRITES go. Stays "n8n" until Phase 2G — read the header first. */
export const ACTIVE_WRITE_SOURCE: DataSource = "n8n";
