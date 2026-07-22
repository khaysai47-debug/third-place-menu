import { createFileRoute } from "@tanstack/react-router";

import { postCreateBotSession } from "../../api/_lib/botSession.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Trusted bot-session creation (Phase 3D), served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/automation/bot-session.ts. Logic lives in api/_lib/botSession.server.ts
// only.

export const Route = createFileRoute("/api/automation/bot-session")({
  server: {
    handlers: {
      POST: ({ request }) => postCreateBotSession(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
