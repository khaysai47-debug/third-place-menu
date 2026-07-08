import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed, postAddExpense } from "../../api/_lib/staffOrderWrites.server";

// Staff add-expense write, served by TanStack Start in dev. In production the
// static-SPA Vercel deploy serves the SAME handler via api/staff/
// add-expense.ts. Logic lives in api/_lib/staffOrderWrites.server.ts only.

export const Route = createFileRoute("/api/staff/add-expense")({
  server: {
    handlers: {
      POST: ({ request }) => postAddExpense(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
