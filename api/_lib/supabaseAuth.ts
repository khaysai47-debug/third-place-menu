// Shared Supabase Data API authentication headers.
// Legacy anon/service_role keys are JWT-shaped and must also be sent as the
// Bearer token. Modern publishable/secret keys are opaque and belong only in
// the apikey header. Classification is structural only: keys are never decoded.

const MODERN_KEY_PREFIXES = ["sb_publishable_", "sb_secret_"] as const;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type SupabaseHeaders = Record<string, string>;

export function supabaseAuthHeaders(
  key: string,
  additionalHeaders: SupabaseHeaders = {},
): SupabaseHeaders {
  if (!key.trim()) throw new Error("Supabase API key is not configured.");

  // Authentication headers are owned here. Preserve every non-auth header,
  // while ensuring an opaque key can never remain in Authorization.
  const headers: SupabaseHeaders = {};
  for (const [name, value] of Object.entries(additionalHeaders)) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "apikey" || normalizedName === "authorization") continue;
    headers[name] = value;
  }
  headers.apikey = key;

  const isModern = MODERN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  if (!isModern && JWT_SHAPE.test(key)) headers.Authorization = `Bearer ${key}`;

  return headers;
}
