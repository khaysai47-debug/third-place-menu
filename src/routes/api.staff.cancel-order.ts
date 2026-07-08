import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  cancelledPatch,
  checkStaffSecret,
  jsonError,
  patchOrderByNumber,
} from "@/lib/staffOrderWrites.server";

// Phase 2G-D staff cancel write — server-side only, NOT LIVE by default
// (ACTIVE_WRITE_SOURCE stays "n8n"). Same DB write the n8n workflow performs
// for status "cancelled": reason (default "Other") + cancelled_at now.

const bodySchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().optional(),
});

export const Route = createFileRoute("/api/staff/cancel-order")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = checkStaffSecret(request);
        if (denied) return denied;

        const body = bodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return jsonError(400, "Invalid request body.");
        const { orderId, reason } = body.data;

        const updated = await patchOrderByNumber(orderId, cancelledPatch(reason));
        if (updated instanceof Response) return updated;
        if (updated === 0) return jsonError(404, "Order not found.");
        return Response.json({ ok: true, orderId, status: "cancelled" });
      },
    },
  },
});
