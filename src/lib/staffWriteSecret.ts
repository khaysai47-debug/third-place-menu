// Client-side staff write secret (Phase 2G-D). The shared secret is entered
// once on the staff device and kept in localStorage — NEVER in env vars or
// the bundle. It is sent as the x-staff-secret header to /api/staff/* routes,
// where the server compares it against STAFF_WRITE_SECRET (server-only env).

const SECRET_KEY = "tp-staff-write-secret";

export function getStaffWriteSecret(): string | null {
  try {
    return localStorage.getItem(SECRET_KEY);
  } catch {
    return null;
  }
}

/** Stores the secret; null or empty clears it. */
export function setStaffWriteSecret(value: string | null): void {
  try {
    if (value) localStorage.setItem(SECRET_KEY, value);
    else localStorage.removeItem(SECRET_KEY);
  } catch {
    // localStorage unavailable (private mode) — writes will fail with a clear error
  }
}

/**
 * Prompts for the shared secret and stores it (empty clears). Used by the
 * /staff + /owner access gates and the staff header ⚿ button (Pre-Pilot
 * Security Hardening). The value never appears in URLs or rendered HTML.
 */
export function promptForSecret(): void {
  const next = window.prompt(
    "員工密碼 · Staff access key (leave empty to clear)",
    getStaffWriteSecret() ?? "",
  );
  if (next === null) return;
  setStaffWriteSecret(next.trim() || null);
}
