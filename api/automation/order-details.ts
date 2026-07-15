// Native Vercel function (Node runtime, web handler signature) — the
// production surface for POST /api/automation/order-details (Phase 3B
// authoritative order fetch for n8n; JWT-authenticated, server-to-server
// only). Delegates to the single shared implementation in api/_lib (also
// used by the dev route). The ".js" extension is REQUIRED: this compiles to
// ESM and Node ESM does no extension resolution (runbook 2G-D2).
import { postOrderDetails } from "../_lib/orderDetails.server.js";
import { methodNotAllowed } from "../_lib/staffOrderWrites.server.js";

export const POST = postOrderDetails;
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
