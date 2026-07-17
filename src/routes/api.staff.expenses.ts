import { createFileRoute } from "@tanstack/react-router";

import { getStaffExpenses } from "../../api/_lib/staffDashboardReads.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Protected dashboard expense read, served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/staff/expenses.ts. Logic lives in api/_lib/staffDashboardReads.server.ts
// only.

export const Route = createFileRoute("/api/staff/expenses")({
  server: {
    handlers: {
      GET: ({ request }) => getStaffExpenses(request),
      POST: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
