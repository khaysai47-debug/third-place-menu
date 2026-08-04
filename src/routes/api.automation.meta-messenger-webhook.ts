import { createFileRoute } from "@tanstack/react-router";

import {
  getMetaMessengerWebhook,
  postMetaMessengerWebhook,
} from "../../api/_lib/metaMessengerWebhook.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// The Meta Messenger callback, served by TanStack Start in dev. Production
// serves the SAME handlers via api/router.ts. Logic lives in
// api/_lib/metaMessengerWebhook.server.ts only.
//
// GET and POST are BOTH mounted here on purpose: Meta subscribes exactly one
// callback URL and uses GET for the verification handshake and POST for event
// deliveries. Splitting them across two URLs is the n8n limitation this route
// exists to replace.
//
// Receive-only. Nothing here calls the Graph API, holds a Page access token,
// or sends a customer message.

export const Route = createFileRoute("/api/automation/meta-messenger-webhook")({
  server: {
    handlers: {
      GET: ({ request }) => getMetaMessengerWebhook(request),
      POST: ({ request }) => postMetaMessengerWebhook(request),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
