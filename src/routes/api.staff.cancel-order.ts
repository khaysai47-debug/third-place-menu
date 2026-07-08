import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed, postCancelOrder } from "../../api/_lib/staffOrderWrites.server";

// Staff cancel write, served by TanStack Start in dev. In production the
// static-SPA Vercel deploy serves the SAME handler via api/staff/
// cancel-order.ts. Logic lives in api/_lib/staffOrderWrites.server.ts only.

export const Route = createFileRoute("/api/staff/cancel-order")({
  server: {
    handlers: {
      POST: ({ request }) => postCancelOrder(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
