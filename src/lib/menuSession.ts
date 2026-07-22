// Client for the public secure-link state endpoint (Phase 3D).
//
// The token travels ONLY in the POST body — never a path segment, never a
// query parameter (see src/lib/menuSessionToken.ts for why).
//
// Reads THROW on transport failure so the page can offer a retry WITHOUT
// discarding the token; a network blip must never be shown as "invalid link".
// Only a real resolved state clears the session bridge.

/** Server-derived link state. "expired" is derived from expires_at, not stored. */
export type MenuSessionState = "active" | "completed" | "expired" | "revoked" | "invalid";

export type MenuSessionPlatform = "instagram" | "messenger";

export interface MenuSessionResult {
  state: MenuSessionState;
  /** Where to send the customer for a fresh link. `platform` is null for an
   *  invalid token — the originating channel of an unknown token is unknowable
   *  and must never be invented. `url` is null when no handle is configured. */
  returnToChat: { platform: MenuSessionPlatform | null; url: string | null };
  /** Present only for a completed session. */
  orderNumber?: string;
}

const STATES: MenuSessionState[] = ["active", "completed", "expired", "revoked", "invalid"];

const isPlatform = (value: unknown): value is MenuSessionPlatform =>
  value === "instagram" || value === "messenger";

/** POSTs the token and maps the response defensively. Throws on transport failure. */
export async function resolveMenuSession(token: string): Promise<MenuSessionResult> {
  const response = await fetch("/api/menu-session/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Secure link lookup failed: ${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    state?: unknown;
    returnToChat?: { platform?: unknown; url?: unknown };
    orderNumber?: unknown;
  } | null;
  if (body?.ok !== true || !STATES.includes(body.state as MenuSessionState)) {
    throw new Error("Secure link lookup returned an unexpected shape");
  }

  const platform = isPlatform(body.returnToChat?.platform) ? body.returnToChat.platform : null;
  const url = typeof body.returnToChat?.url === "string" ? body.returnToChat.url : null;
  return {
    state: body.state as MenuSessionState,
    returnToChat: { platform, url },
    ...(typeof body.orderNumber === "string" ? { orderNumber: body.orderNumber } : {}),
  };
}
