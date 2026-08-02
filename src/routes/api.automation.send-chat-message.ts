import { createFileRoute } from "@tanstack/react-router";

import { postSendChatMessage } from "../../api/_lib/chatMessaging.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// App-owned customer messaging (x-chat-messaging-secret), served by TanStack
// Start in dev. Production serves the SAME handler via api/router.ts. Logic
// lives in api/_lib/chatMessaging.server.ts only.
//
// Nothing calls this yet: n8n is not wired to it and the Meta adapter is
// disabled, so a request can never reach a real customer.

export const Route = createFileRoute("/api/automation/send-chat-message")({
  server: {
    handlers: {
      POST: ({ request }) => postSendChatMessage(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
