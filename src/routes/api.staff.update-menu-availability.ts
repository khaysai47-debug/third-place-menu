import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed, postUpdateMenuAvailability } from "../../api/_lib/staffOrderWrites.server";

// Staff menu availability write, served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/staff/update-menu-availability.ts. Logic lives in
// api/_lib/staffOrderWrites.server.ts only.

export const Route = createFileRoute("/api/staff/update-menu-availability")({
  server: {
    handlers: {
      POST: ({ request }) => postUpdateMenuAvailability(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
