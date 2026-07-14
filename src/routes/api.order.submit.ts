import { createFileRoute } from "@tanstack/react-router";

import { postCustomerOrder } from "../../api/_lib/orderIntake.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Customer order intake (Phase 2G-I), served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/order/submit.ts. Logic lives in api/_lib/orderIntake.server.ts only.

export const Route = createFileRoute("/api/order/submit")({
  server: {
    handlers: {
      POST: ({ request }) => postCustomerOrder(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
