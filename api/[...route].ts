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
// the count from 10 to 13 — the Preview deploy failed with
// "No more than 12 Serverless Functions can be added to a Deployment on the
// Hobby plan." This file replaces all 13 entrypoints with ONE, so the whole API
// costs a single function.
//
// WHAT DID NOT CHANGE: every public URL, every HTTP method, and every handler.
// The handlers still live in api/_lib/*.server.ts — the single implementation
// layer — and are still shared byte-for-byte with the TanStack dev routes in
// src/routes/api.*.ts (those are untouched; `npm run dev` behaves exactly as
// before). This file is dispatch only: it contains NO business logic, no
// Supabase calls, no secrets, and no CORS headers.
//
// The bracketed filename is Vercel's documented catch-all convention: it
// receives every /api/* request that no more specific file claims — and after
// this consolidation there are no more specific files. Files under api/_lib are
// excluded from function counting by the underscore prefix (which is why the
// failing deploy counted 13, not 19).

type Handler = (request: Request) => Promise<Response> | Response;

/**
 * The routing table, keyed by the path AFTER "/api/".
 *
 * Adding a route here is the ONLY step needed for a new endpoint on the
 * production surface — but remember its TanStack dev-route twin in
 * src/routes/api.*.ts, which is what serves it under `npm run dev`.
 */
const ROUTES: Record<string, Partial<Record<"GET" | "POST", Handler>>> = {
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

/**
 * Normalises a request URL to a ROUTES key.
 *
 * Deliberately tolerant about the "/api" prefix and about trailing slashes:
 * the catch-all receives the original path on Vercel, but a platform that
 * strips the mount prefix would otherwise silently 404 every endpoint. Matching
 * on the suffix makes the table correct either way. Query strings are excluded
 * by URL.pathname.
 */
function routeKey(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Defensive: a relative URL should never reach here, but never throw.
    pathname = url.split("?")[0];
  }
  return pathname
    .replace(/^\/+/, "") // leading slashes
    .replace(/^api\//, "") // the /api mount prefix, if present
    .replace(/\/+$/, ""); // trailing slashes
}

/** 405 with the same JSON body the per-file handlers returned, plus Allow. */
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
  const route = ROUTES[routeKey(request.url)];
  if (!route) return jsonError(404, "Not found.");

  // HEAD is answered by the GET handler; the runtime drops the body. Anything
  // else (PUT/PATCH/DELETE/OPTIONS/…) falls through to the 405 below.
  const method = request.method.toUpperCase();
  const handler = route[method === "HEAD" ? "GET" : (method as "GET" | "POST")];
  if (!handler) return methodNotAllowed(Object.keys(route));

  return handler(request);
}

// Named method exports — the same web-handler shape the per-endpoint files
// used. Every verb goes through one dispatcher so that path resolution happens
// before method checking, which is what lets a wrong method on a REAL route
// return 405 while any method on an UNKNOWN route returns 404.
export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const HEAD = dispatch;
export const OPTIONS = dispatch;
