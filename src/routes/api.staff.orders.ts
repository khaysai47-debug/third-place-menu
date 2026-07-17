import { createFileRoute } from "@tanstack/react-router";

import { getStaffOrders } from "../../api/_lib/staffDashboardReads.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Protected dashboard order read, served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/staff/orders.ts. Logic lives in api/_lib/staffDashboardReads.server.ts
// only.

export const Route = createFileRoute("/api/staff/orders")({
  server: {
    handlers: {
      GET: ({ request }) => getStaffOrders(request),
      POST: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
