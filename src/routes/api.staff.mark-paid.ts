import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { checkStaffSecret, jsonError, patchOrderByNumber } from "@/lib/staffOrderWrites.server";

// Phase 2G-D staff mark-paid write — server-side only, NOT LIVE by default
// (ACTIVE_WRITE_SOURCE stays "n8n"). Replicates the n8n Update Payment
// workflow: payment_status "Paid", payment_method verbatim, paid_at now.
// Cash and Transfer only — the app's exact StaffPaymentMethod vocabulary.

const bodySchema = z.object({
  orderId: z.string().min(1),
  paymentMethod: z.enum(["Cash", "Transfer"]),
});

export const Route = createFileRoute("/api/staff/mark-paid")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = checkStaffSecret(request);
        if (denied) return denied;

        const body = bodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return jsonError(400, "Invalid request body.");
        const { orderId, paymentMethod } = body.data;

        const updated = await patchOrderByNumber(orderId, {
          payment_status: "Paid",
          payment_method: paymentMethod,
          paid_at: new Date().toISOString(),
        });
        if (updated instanceof Response) return updated;
        if (updated === 0) return jsonError(404, "Order not found.");
        return Response.json({ ok: true, orderId, paymentStatus: "paid", paymentMethod });
      },
    },
  },
});
