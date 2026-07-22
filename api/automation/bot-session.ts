// Native Vercel function (Node runtime, web handler signature) — the
// production surface for POST /api/automation/bot-session (Phase 3D trusted
// bot-session creation; x-bot-secret, server-to-server only). Delegates to the
// single shared implementation in api/_lib (also used by the dev route). The
// ".js" extension is REQUIRED: this compiles to ESM and Node ESM does no
// extension resolution (runbook 2G-D2).
import { postCreateBotSession } from "../_lib/botSession.server.js";
import { methodNotAllowed } from "../_lib/staffOrderWrites.server.js";

export const POST = postCreateBotSession;
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
