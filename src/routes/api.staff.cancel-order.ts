import { createFileRoute } from "@tanstack/react-router";

import { postCancelOrder } from "@/lib/staffOrderWrites.server";

// Staff cancel write, served by TanStack Start in dev. In production the
// static-SPA Vercel deploy serves the SAME handler via api/staff/
// cancel-order.ts. Logic lives in staffOrderWrites.server.ts only.

export const Route = createFileRoute("/api/staff/cancel-order")({
  server: {
    handlers: {
      POST: ({ request }) => postCancelOrder(request),
    },
  },
});
