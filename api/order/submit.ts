// Native Vercel function (Node runtime, web handler signature) — the
// production surface for POST /api/order/submit (Phase 2G-I customer
// checkout; PUBLIC — customers are not logged in). Delegates to the single
// shared implementation in api/_lib (also used by the dev route). The ".js"
// extension is REQUIRED: this compiles to ESM and Node ESM does no extension
// resolution (runbook 2G-D2).
import { postCustomerOrder } from "../_lib/orderIntake.server.js";
import { methodNotAllowed } from "../_lib/staffOrderWrites.server.js";

export const POST = postCustomerOrder;
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
