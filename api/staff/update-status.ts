// Native Vercel function (Node runtime, web handler signature) — the
// production surface for POST /api/staff/update-status. The deployed site is
// a static SPA, so TanStack server routes don't run on Vercel; this delegates
// to the same single implementation used by the dev route.
import { postUpdateStatus } from "../../src/lib/staffOrderWrites.server";

export const POST = postUpdateStatus;
