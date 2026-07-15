import { createFileRoute } from "@tanstack/react-router";

import { postOrderDetails } from "../../api/_lib/orderDetails.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Authoritative order fetch for n8n automation (Phase 3B), served by
// TanStack Start in dev. In production the static-SPA Vercel deploy serves
// the SAME handler via api/automation/order-details.ts. Logic lives in
// api/_lib/orderDetails.server.ts only.

export const Route = createFileRoute("/api/automation/order-details")({
  server: {
    handlers: {
      POST: ({ request }) => postOrderDetails(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
