import { createFileRoute } from "@tanstack/react-router";

import { getProofHistory } from "../../api/_lib/staffDashboardReads.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Staff per-order proof audit history with signed previews (revised Tuesday),
// served by TanStack Start in dev. Production serves the SAME handler via
// api/router.ts. Logic lives in api/_lib/staffDashboardReads.server.ts only.

export const Route = createFileRoute("/api/staff/proof-history")({
  server: {
    handlers: {
      GET: ({ request }) => getProofHistory(request),
      POST: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
