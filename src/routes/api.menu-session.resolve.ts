import { createFileRoute } from "@tanstack/react-router";

import { postResolveSession } from "../../api/_lib/botSession.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Secure-link state lookup (Phase 3D), served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/menu-session/resolve.ts. Logic lives in api/_lib/botSession.server.ts
// only.

export const Route = createFileRoute("/api/menu-session/resolve")({
  server: {
    handlers: {
      POST: ({ request }) => postResolveSession(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
