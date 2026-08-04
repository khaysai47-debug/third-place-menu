import { createFileRoute } from "@tanstack/react-router";

import { postSendChatMessage } from "../../api/_lib/chatMessaging.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// App-owned customer messaging (x-chat-messaging-secret), served by TanStack
// Start in dev. Production serves the SAME handler via api/router.ts. Logic
// lives in api/_lib/chatMessaging.server.ts only.
//
// The Messenger adapter is LIVE (Instagram is not). Nothing calls this route
// yet — the n8n Atlas Chat Sender nodes are disabled and disconnected — but a
// request WITH the shared secret now reaches a real customer. Treat it as a
// live send path.

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
