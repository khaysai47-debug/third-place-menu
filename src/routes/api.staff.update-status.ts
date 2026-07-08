import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed, postUpdateStatus } from "../../api/_lib/staffOrderWrites.server";

// Staff status write, served by TanStack Start in dev. In production the
// static-SPA Vercel deploy serves the SAME handler via api/staff/
// update-status.ts. Logic lives in api/_lib/staffOrderWrites.server.ts only.

export const Route = createFileRoute("/api/staff/update-status")({
  server: {
    handlers: {
      POST: ({ request }) => postUpdateStatus(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
