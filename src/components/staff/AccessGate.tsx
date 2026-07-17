import { type FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { setStaffWriteSecret } from "@/lib/staffWriteSecret";

// Pilot access gate for /staff and /owner (Pre-Pilot Security Hardening).
// The shared access key is entered in this themed in-app form (no browser
// prompt), stored in the existing trusted-device localStorage slot, and
// validated by the SERVER on the first protected read — every /api/staff/*
// route checks x-staff-secret; this gate is only the UX in front of that.
// The key never appears in a URL, in rendered HTML, or in logs.
// ponytail: shared-secret gate for a one-iPad pilot; replace with real staff
// accounts after the pilot.

const AREA_COPY = {
  staff: { title: "Staff Access", label: "员工专用" },
  owner: { title: "Owner Access", label: "店主专用" },
} as const;

interface Props {
  area: keyof typeof AREA_COPY;
  /** True when the server rejected the stored/entered key (401). */
  denied: boolean;
  /** Called after the entered key is stored — the page validates by loading. */
  onSubmitted: () => void;
  /** Optional (header "change key" flow): keep the current key and go back. */
  onCancel?: () => void;
}

export function AccessGate({ area, denied, onSubmitted, onCancel }: Props) {
  const { title, label } = AREA_COPY[area];
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The server's verdict arrives through the `denied` prop — a rejected key
  // re-enables the form (success unmounts the gate instead).
  useEffect(() => {
    if (denied) setSubmitting(false);
  }, [denied]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next = key.trim();
    if (!next || submitting) return;
    setSubmitting(true);
    setStaffWriteSecret(next);
    onSubmitted();
  };

  return (
    <div className="min-h-screen ink-grain flex items-center justify-center px-5">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[360px] rounded-2xl border border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)]/70 px-7 py-9"
      >
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-gold-soft)]/70">
          {label}
        </p>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-[var(--color-cream)]">
          {title}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
          Enter your access key to continue.
        </p>

        <div className="relative mt-6">
          <input
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="Access key"
            autoFocus
            autoComplete="current-password"
            aria-label="Access key"
            aria-invalid={denied || undefined}
            disabled={submitting}
            className="h-12 w-full rounded-xl border border-[var(--color-gold)]/25 bg-[var(--color-ink)] px-4 pr-12 text-[15px] text-[var(--color-cream)] placeholder:text-[var(--color-cream)]/30 transition focus:border-[var(--color-gold)]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]/40 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? "Hide access key" : "Show access key"}
            className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--color-gold-soft)]/60 transition hover:text-[var(--color-cream)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]/40"
          >
            {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        {denied && !submitting && (
          <p role="alert" className="mt-2 text-[13px] font-medium text-[#E2564B]">
            Incorrect access key.
          </p>
        )}

        <button
          type="submit"
          disabled={!key.trim() || submitting}
          className="mt-5 h-12 w-full rounded-xl bg-[var(--color-vermillion)] text-[15px] font-semibold tracking-[0.02em] text-[var(--color-cream)] shadow-lg shadow-[var(--color-vermillion)]/30 transition hover:bg-[#E24A3F] active:scale-[0.99] disabled:opacity-40 disabled:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-charcoal-soft)]"
        >
          {submitting ? "Checking…" : "Continue"}
        </button>

        {onCancel && !submitting && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-4 w-full text-center text-[13px] text-[var(--color-gold-soft)]/70 transition hover:text-[var(--color-cream)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]/40 rounded-lg h-9"
          >
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
