// Secure menu-link token handling in the browser (Phase 3D).
//
// TRANSPORT: the token arrives in the URL FRAGMENT — `/m#<token>`.
// The fragment is the only URL component browsers never put in the HTTP
// request line (RFC 3986 § 3.5) and always strip from `Referer`. So the token
// reaches no Vercel/CDN/proxy/WAF access log, no link-preview crawler, and no
// error reporter (src/lib/lovable-error-reporting.ts sends
// window.location.pathname, which here is just "/m").
//
// A path (`/m/<token>`) or query (`/m?token=`) form would leak into every one
// of those. Never move the token into either.
//
// AFTER CAPTURE the fragment is removed from the address bar, which would
// otherwise survive in history, screenshots and screen-shares. That removal
// breaks refresh and iOS tab-restore, so the token is bridged through
// sessionStorage:
//   - sessionStorage, NOT localStorage: tab-scoped and origin-scoped, and
//     destroyed when the tab closes.
//   - The marginal risk over holding it in memory is small: the token is
//     already page-resident and already attached to outbound requests, so
//     script execution on this origin defeats either equally — and this app
//     loads no third-party JavaScript (only a Google Fonts stylesheet).
//   - It is erased the moment it stops mattering (any terminal state).
//
// The one capability deliberately given up: reopening from browser history
// after the tab was closed. The chat thread holds the durable link.
//
// NEVER log the token, and never write it anywhere but this session-scoped
// slot and POST bodies.

const STORAGE_KEY = "tp_menu_session";

/** 32 bytes of HMAC output, base64url, unpadded — mirrors the server. */
export const MENU_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const readStorage = (): string | null => {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled — the in-memory token still works for
    // this page view; only refresh recovery is lost.
    return null;
  }
};

const writeStorage = (token: string): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Same as above — non-fatal.
  }
};

/** True when the address bar still carries a fragment worth removing. */
export function hasMenuSessionFragment(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hash.length > 1;
}

/**
 * Reads the token from the URL fragment, falling back to the sessionStorage
 * bridge. Call this SYNCHRONOUSLY during render initialisation (a useState
 * initialiser), never from an effect — nothing may observe or clear the
 * fragment first.
 *
 * Returns null when there is no valid token, which the page renders as the
 * invalid-link state.
 */
export function captureMenuSessionToken(): string | null {
  if (typeof window === "undefined") return null;

  // A freshly tapped link always wins over a stale bridge value.
  const fragment = window.location.hash.replace(/^#/, "");
  if (MENU_SESSION_TOKEN_PATTERN.test(fragment)) {
    writeStorage(fragment);
    return fragment;
  }

  const stored = readStorage();
  if (stored && MENU_SESSION_TOKEN_PATTERN.test(stored)) return stored;

  // A stored value that no longer matches the shape is junk, not a session.
  if (stored) clearMenuSessionToken();
  return null;
}

/** Drops the bridged token. Called on every terminal session state. */
export function clearMenuSessionToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — storage is unavailable, so nothing was stored.
  }
}
