import { createFileRoute } from "@tanstack/react-router";

import { postSessionOrder } from "../../api/_lib/botSession.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Bot-session checkout (Phase 3D), served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/order/submit-session.ts. Logic lives in api/_lib/botSession.server.ts
// only.

export const Route = createFileRoute("/api/order/submit-session")({
  server: {
    handlers: {
      POST: ({ request }) => postSessionOrder(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
