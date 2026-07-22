import {
  postCreateBotSession,
  postResolveSession,
  postSessionOrder,
} from "./_lib/botSession.server.js";
import { postOrderDetails } from "./_lib/orderDetails.server.js";
import { postCustomerOrder, postStaffAddOrder } from "./_lib/orderIntake.server.js";
import { getStaffExpenses, getStaffOrders } from "./_lib/staffDashboardReads.server.js";
import {
  jsonError,
  postAddExpense,
  postCancelOrder,
  postMarkPaid,
  postUpdateMenuAvailability,
  postUpdateStatus,
} from "./_lib/staffOrderWrites.server.js";

// SINGLE native Vercel function for the ENTIRE /api surface.
//
// WHY THIS EXISTS: Vercel's Hobby plan allows at most 12 Serverless Functions
// per deployment. Each api/**/<name>.ts file is one function, and Phase 3D took
// the count from 10 to 13 — the Preview deploy failed with "No more than 12
// Serverless Functions can be added to a Deployment on the Hobby plan." This
// file serves all 13 endpoints from ONE function.
//
// WHY NOT A FILESYSTEM CATCH-ALL: the first attempt used api/[...route].ts.
// It deployed (one function, state READY) but every nested URL returned a
// PLATFORM 404 (x-vercel-error: NOT_FOUND) — the request never reached this
// code. Bracketed catch-all filenames are a framework convention (Next.js);
// plain Vercel Functions map api/<name>.ts to exactly /api/<name> and do not
// expand [...] segments. The supported mechanism for "one function, many URLs"
// is an explicit rewrite, which is what vercel.json now does:
//
//     { "source": "/api/:path*", "destination": "/api/router?path=:path*" }
//
// So this file MUST live at the fixed path api/router.ts, and the original
// requested path arrives in the `path` QUERY PARAMETER — not in the pathname,
// which after the rewrite is always "/api/router".
//
// WHAT DID NOT CHANGE: every public URL, every HTTP method, every handler. The
// handlers still live in api/_lib/*.server.ts — the single implementation
// layer, untouched — and are still shared with the TanStack dev routes in
// src/routes/api.*.ts (untouched; `npm run dev` does not use vercel.json and
// serves the real paths directly). This file is dispatch only: NO business
// logic, no Supabase calls, no secrets, no CORS headers.

type Method = "GET" | "POST";
type Handler = (request: Request) => Promise<Response> | Response;
type Route = Partial<Record<Method, Handler>>;

/** The query parameter the vercel.json rewrite carries the real path in. */
const ROUTE_PARAM = "path";

/**
 * The routing table, keyed by the path AFTER "/api/".
 *
 * Adding a route here is the only change needed on the production surface —
 * the vercel.json rewrite is a wildcard and needs no edit. Remember the
 * TanStack dev-route twin in src/routes/api.*.ts, which serves it under
 * `npm run dev`.
 */
const ROUTES: Record<string, Route> = {
  // ── Automation (trusted server-to-server) ────────────────────────────────
  "automation/bot-session": { POST: postCreateBotSession },
  "automation/order-details": { POST: postOrderDetails },

  // ── Customer-facing ──────────────────────────────────────────────────────
  "menu-session/resolve": { POST: postResolveSession },
  "order/submit": { POST: postCustomerOrder },
  "order/submit-session": { POST: postSessionOrder },

  // ── Staff writes (x-staff-secret) ────────────────────────────────────────
  "staff/add-expense": { POST: postAddExpense },
  "staff/add-order": { POST: postStaffAddOrder },
  "staff/cancel-order": { POST: postCancelOrder },
  "staff/mark-paid": { POST: postMarkPaid },
  "staff/update-menu-availability": { POST: postUpdateMenuAvailability },
  "staff/update-status": { POST: postUpdateStatus },

  // ── Staff reads (x-staff-secret) ─────────────────────────────────────────
  "staff/expenses": { GET: getStaffExpenses },
  "staff/orders": { GET: getStaffOrders },
};

/** Strips the mount prefix and slashes so a candidate can be matched. */
const normalise = (candidate: string): string =>
  candidate
    .replace(/^\/+/, "") // leading slashes
    .replace(/^api\//, "") // the /api mount prefix, if present
    .replace(/\/+$/, ""); // trailing slashes

/**
 * Resolves the ORIGINAL requested API path to a route.
 *
 * Candidate order:
 *  1. every `path` query value — set by the vercel.json rewrite. This is the
 *     authoritative source in production, because after the rewrite the
 *     pathname is always "/api/router".
 *  2. the pathname — the fallback for a direct hit on this function and the
 *     shape used by the local test suite. Harmless in production (it resolves
 *     to "router", which is not a route).
 *
 * ALL `path` values are tried, in order, because Vercel merges the incoming
 * request's query string into the rewrite destination: a client that appends
 * its own `?path=` produces two values and the platform's ordering is not
 * contractually fixed. Trying each and taking the first that names a REAL
 * route makes resolution deterministic either way.
 *
 * That cannot be used to escalate: every handler enforces its own
 * authentication (x-staff-secret, x-bot-secret, or a signed JWT) after this
 * point, and reaching a PUBLIC endpoint by a different URL is exactly
 * equivalent to calling it directly. No handler reads the query string or the
 * URL at all, so nothing else can be influenced from here.
 */
function resolveRoute(url: string): Route | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Defensive: a relative URL should never reach a Vercel function.
    parsed = new URL(url, "https://invalid.local");
  }

  for (const candidate of [...parsed.searchParams.getAll(ROUTE_PARAM), parsed.pathname]) {
    const route = ROUTES[normalise(candidate)];
    if (route) return route;
  }
  return null;
}

/** 405 with the same JSON body the per-endpoint files returned, plus Allow. */
function methodNotAllowed(allowed: string[]): Response {
  // HEAD is served wherever GET is, so it belongs in Allow too.
  const allow = allowed.includes("GET") ? [...allowed, "HEAD"] : allowed;
  return Response.json(
    { ok: false, error: "Method not allowed." },
    { status: 405, headers: { Allow: allow.join(", ") } },
  );
}

/**
 * The single entry point. Resolves path → route, then method → handler.
 * Unknown path → 404. Known path, wrong method → 405 with Allow.
 * No CORS headers are emitted, by design: /api is same-origin for the app and
 * server-to-server for automation.
 */
function dispatch(request: Request): Promise<Response> | Response {
  const route = resolveRoute(request.url);
  if (!route) return jsonError(404, "Not found.");

  // HEAD is answered by the GET handler; the runtime drops the body. Anything
  // else (PUT/PATCH/DELETE/OPTIONS/…) falls through to the 405 below.
  const method = request.method.toUpperCase();
  const handler = route[method === "HEAD" ? "GET" : (method as Method)];
  if (!handler) return methodNotAllowed(Object.keys(route));

  return handler(request);
}

// Named method exports — the same web-handler shape the per-endpoint files
// used. Every verb goes through one dispatcher so that path resolution happens
// BEFORE method checking, which is what lets a wrong method on a REAL route
// return 405 while any method on an UNKNOWN route returns 404.
export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const HEAD = dispatch;
export const OPTIONS = dispatch;
