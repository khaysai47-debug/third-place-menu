import { createFileRoute } from "@tanstack/react-router";

import { postAutomationPaymentProof } from "../../api/_lib/paymentIntake.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Trusted payment-proof intake from n8n (x-proof-secret), served by TanStack
// Start in dev. Production serves the SAME handler via api/router.ts. Logic
// lives in api/_lib/paymentIntake.server.ts only.

export const Route = createFileRoute("/api/automation/payment-proof")({
  server: {
    handlers: {
      POST: ({ request }) => postAutomationPaymentProof(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
