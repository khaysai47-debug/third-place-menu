import { createHmac, timingSafeEqual } from "node:crypto";

// Shared order-event JWT contract — Phase 3A (sign, outgoing bridge) and
// Phase 3B (verify, /api/automation/order-details) MUST agree on one set of
// constants, so both live here. buildOrderEventJwt was extracted VERBATIM
// from orderIntake.server.ts (Phase 3A behavior unchanged; orderIntake
// re-exports it for scripts/test-automation-bridge.mjs).
//
// node:crypto only — no jwt dependency. No secrets at module scope; the
// callers pass the secret in. Never log tokens, secrets, or claims here.

export const JWT_ISSUER = "atlas-order-bridge";
export const JWT_AUDIENCE = "n8n-order-automation";
export const JWT_SUBJECT = "order.created";

/**
 * Verification clock tolerance in seconds — absorbs skew between Vercel and
 * n8n clocks. Applied to exp (accept up to 30 s past expiry), nbf (reject
 * tokens valid only >30 s in the future), and iat (reject tokens issued
 * >30 s in the future). Same tolerance the n8n JWT node is configured with.
 */
export const JWT_CLOCK_TOLERANCE_S = 30;

// Structural bounds for incoming tokens (Phase 3A tokens are ~600 bytes).
const MAX_JWT_LENGTH = 4096;
const B64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

export type OrderCreatedEvent = {
  eventId: string;
  eventType: "order.created";
  occurredAt: string;
  orderNumber: string;
  channel: "customer" | "staff";
};

/**
 * HS256 JWT over the order event, node:crypto only (no jwt dependency).
 * 120 s lifetime, 5 s nbf backdate for clock skew. Exported for the
 * standalone check (scripts/test-automation-bridge.mjs).
 */
export function buildOrderEventJwt(event: OrderCreatedEvent, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      sub: JWT_SUBJECT,
      jti: event.eventId,
      iat: now,
      nbf: now - 5,
      exp: now + 120,
      ...event,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const asJsonObject = (segment: string): Record<string, unknown> | null => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const isSeconds = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Verifies an incoming order-event JWT (Phase 3B). Returns the claims on
 * success, null on ANY failure — callers answer every null with one generic
 * 401 so responses never reveal which check failed. Checks, in order:
 * structure (3 base64url segments, bounded length), header (valid JSON,
 * alg exactly HS256 — "none" and everything else rejected), signature
 * (HMAC-SHA256 recomputed and compared with crypto.timingSafeEqual),
 * registered claims (iss/aud/sub, jti === eventId, exp/nbf/iat within
 * JWT_CLOCK_TOLERANCE_S), and event claim types. The caller still must bind
 * eventId + orderNumber to its request body.
 */
export function verifyOrderEventJwt(token: string, secret: string): Record<string, unknown> | null {
  if (token.length === 0 || token.length > MAX_JWT_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!parts.every((part) => B64URL_SEGMENT.test(part))) return null;

  const header = asJsonObject(headerB64);
  if (!header || header.alg !== "HS256") return null;

  const expected = createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest();
  const given = Buffer.from(signatureB64, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const claims = asJsonObject(payloadB64);
  if (!claims) return null;
  if (claims.iss !== JWT_ISSUER || claims.aud !== JWT_AUDIENCE || claims.sub !== JWT_SUBJECT) {
    return null;
  }
  if (typeof claims.jti !== "string" || claims.jti.length === 0) return null;
  if (claims.jti !== claims.eventId) return null;
  if (typeof claims.orderNumber !== "string" || claims.orderNumber.length === 0) return null;
  if (claims.eventType !== JWT_SUBJECT) return null;
  if (typeof claims.occurredAt !== "string") return null;
  if (claims.channel !== "customer" && claims.channel !== "staff") return null;

  if (!isSeconds(claims.exp) || !isSeconds(claims.nbf) || !isSeconds(claims.iat)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - JWT_CLOCK_TOLERANCE_S >= claims.exp) return null; // expired
  if (claims.nbf > now + JWT_CLOCK_TOLERANCE_S) return null; // not valid yet
  if (claims.iat > now + JWT_CLOCK_TOLERANCE_S) return null; // issued in the future

  return claims;
}
