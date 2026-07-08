import { createFileRoute } from "@tanstack/react-router";

import { postUpdateStatus } from "@/lib/staffOrderWrites.server";

// Staff status write, served by TanStack Start in dev. In production the
// static-SPA Vercel deploy serves the SAME handler via api/staff/
// update-status.ts. Logic lives in staffOrderWrites.server.ts only.

export const Route = createFileRoute("/api/staff/update-status")({
  server: {
    handlers: {
      POST: ({ request }) => postUpdateStatus(request),
    },
  },
});
