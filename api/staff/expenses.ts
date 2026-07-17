// Native Vercel function (Node runtime, web handler signature) — the
// production surface for GET /api/staff/expenses (protected dashboard
// expense snapshot; x-staff-secret). Delegates to the single shared
// implementation in api/_lib (also used by the dev route). The ".js"
// extension is REQUIRED: this compiles to ESM and Node ESM does no
// extension resolution (runbook 2G-D2).
import { getStaffExpenses } from "../_lib/staffDashboardReads.server.js";
import { methodNotAllowed } from "../_lib/staffOrderWrites.server.js";

export const GET = getStaffExpenses;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
