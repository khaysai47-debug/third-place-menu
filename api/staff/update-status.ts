// Native Vercel function (Node runtime, web handler signature) — the
// production surface for POST /api/staff/update-status. Delegates to the
// single shared implementation in api/_lib (also used by the dev route).
// The ".js" extension is REQUIRED: this compiles to ESM and Node ESM does
// no extension resolution (runbook 2G-D2).
import { methodNotAllowed, postUpdateStatus } from "../_lib/staffOrderWrites.server.js";

export const POST = postUpdateStatus;
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
