import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed, postMarkPaid } from "../../api/_lib/staffOrderWrites.server";

// Staff mark-paid write, served by TanStack Start in dev. In production the
// static-SPA Vercel deploy serves the SAME handler via api/staff/
// mark-paid.ts. Logic lives in api/_lib/staffOrderWrites.server.ts only.

export const Route = createFileRoute("/api/staff/mark-paid")({
  server: {
    handlers: {
      POST: ({ request }) => postMarkPaid(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
