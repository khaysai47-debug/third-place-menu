import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ORDER_STATUS_VALUES } from "@/lib/data/contracts/orderContract";
import { normalizeOrderStatusToDb } from "@/lib/data/mappers/orderMapper";
import type { StaffOrderStatus } from "@/lib/staffOrders";
import {
  cancelledPatch,
  checkStaffSecret,
  jsonError,
  patchOrderByNumber,
} from "@/lib/staffOrderWrites.server";

// Phase 2G-D staff status write — server-side only, NOT LIVE by default
// (ACTIVE_WRITE_SOURCE stays "n8n"). Replicates the n8n Update Order Status
// workflow: non-cancel statuses reset the cancellation fields; "cancelled"
// stamps reason + cancelled_at. App status "done" is stored as "completed".

const bodySchema = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
  cancellationReason: z.string().optional(),
});

export const Route = createFileRoute("/api/staff/update-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = checkStaffSecret(request);
        if (denied) return denied;

        const body = bodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return jsonError(400, "Invalid request body.");
        const { orderId, status, cancellationReason } = body.data;
        if (!ORDER_STATUS_VALUES.includes(status as StaffOrderStatus)) {
          return jsonError(400, `Unknown status "${status}".`);
        }

        const patch =
          status === "cancelled"
            ? cancelledPatch(cancellationReason)
            : {
                status: normalizeOrderStatusToDb(status as StaffOrderStatus),
                cancellation_reason: null,
                cancelled_at: null,
              };
        const updated = await patchOrderByNumber(orderId, patch);
        if (updated instanceof Response) return updated;
        if (updated === 0) return jsonError(404, "Order not found.");
        return Response.json({ ok: true, orderId, status });
      },
    },
  },
});
