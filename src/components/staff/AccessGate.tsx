import { promptForSecret } from "@/lib/staffWriteSecret";

// Pilot access gate for /staff and /owner (Pre-Pilot Security Hardening).
// The shared staff secret must be entered before any dashboard data loads;
// the SERVER is the real enforcement (every /api/staff/* read and write
// checks x-staff-secret) — this gate is the UX in front of it. The secret
// lives only in the existing trusted-device localStorage slot (⚿ flow),
// never in a URL, never in rendered HTML.
// ponytail: shared-secret gate for a one-iPad pilot; replace with real staff
// accounts after the pilot.

interface Props {
  /** Page name for the heading, e.g. "Staff" / "Owner". */
  area: string;
  /** True when the server rejected the stored secret (401). */
  denied: boolean;
  /** Called after the prompt closes so the page can re-check and reload. */
  onSubmitted: () => void;
}

export function AccessGate({ area, denied, onSubmitted }: Props) {
  return (
    <div className="min-h-screen ink-grain flex items-center justify-center px-5">
      <div className="w-full max-w-[420px] rounded-2xl border border-[var(--color-gold)]/25 bg-[var(--color-charcoal-soft)]/70 px-6 py-10 text-center">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-gold-soft)]/80">
          The Third Place — {area}
        </p>
        <p className="mt-3 font-display text-[24px] leading-tight text-[var(--color-cream)]">
          需要通行密碼 · Access key required
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
          {denied
            ? "密碼錯誤，請重新輸入 · The entered key was rejected — please try again."
            : "此頁面只限員工使用 · This area is staff-only. Enter the access key to continue."}
        </p>
        <button
          onClick={() => {
            promptForSecret();
            onSubmitted();
          }}
          className="mt-6 h-12 px-8 rounded-full bg-[var(--color-vermillion)] text-[var(--color-cream)] text-[15px] font-semibold tracking-[0.02em] active:scale-[0.97] transition"
        >
          ⚿ 輸入密碼 · Enter access key
        </button>
      </div>
    </div>
  );
}
