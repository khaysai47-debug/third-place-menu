import { createFileRoute } from "@tanstack/react-router";

import { postReviewPaymentProof } from "../../api/_lib/paymentProof.server";
import { methodNotAllowed } from "../../api/_lib/staffOrderWrites.server";

// Staff payment-proof review (Tuesday), served by TanStack Start in dev. In
// production the static-SPA Vercel deploy serves the SAME handler via
// api/router.ts. Logic lives in api/_lib/paymentProof.server.ts only.

export const Route = createFileRoute("/api/staff/review-payment-proof")({
  server: {
    handlers: {
      POST: ({ request }) => postReviewPaymentProof(request),
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      PATCH: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
