import { createFileRoute } from "@tanstack/react-router";

import { postStaffAddOrder } from "../../api/_lib/orderIntake.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Staff Add Order intake (Phase 2G-I), served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/staff/add-order.ts. Logic lives in api/_lib/orderIntake.server.ts only.

export const Route = createFileRoute("/api/staff/add-order")({
  server: {
    handlers: {
      POST: ({ request }) => postStaffAddOrder(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
