import { redact } from "../redact.mjs";
import { BOUNDARIES } from "../workers/contract.mjs";
import { createJsonClient, requireMutations } from "./http.mjs";

const nodeSummary = (node) => ({
  id: node.id ?? null,
  name: node.name,
  type: node.type,
  disabled: node.disabled === true,
});

export function createN8nConnector({
  env = process.env,
  fetchImpl = globalThis.fetch,
  baseUrl = env.ATLAS_N8N_URL ?? env.N8N_API_URL,
  apiKey = env.ATLAS_N8N_API_KEY ?? env.N8N_API_KEY,
  allowMutations = false,
} = {}) {
  if (!baseUrl || !apiKey) return null;
  const request = createJsonClient({
    baseUrl: `${String(baseUrl).replace(/\/+$/, "")}/api/v1`,
    headers: { "X-N8N-API-KEY": apiKey },
    fetchImpl,
  });

  return {
    approvalTarget: { service: "n8n", baseUrl: String(baseUrl).replace(/\/+$/, "") },
    async inspect_workflow({ workflowId }) {
      if (!workflowId) throw new Error("workflowId is required");
      const workflow = await request(`/workflows/${encodeURIComponent(workflowId)}`);
      return {
        ok: true,
        summary: `workflow ${workflow.id} is ${workflow.active ? "active" : "inactive"} with ${(workflow.nodes ?? []).length} nodes`,
        verifies: [BOUNDARIES.n8nWorkflow],
        data: {
          id: workflow.id,
          name: workflow.name,
          active: workflow.active === true,
          versionId: workflow.versionId ?? null,
          nodes: (workflow.nodes ?? []).map(nodeSummary),
        },
      };
    },

    async inspect_execution({ executionId }) {
      if (!executionId) throw new Error("executionId is required");
      const execution = await request(
        `/executions/${encodeURIComponent(executionId)}?includeData=true`,
      );
      const error = execution.data?.resultData?.error;
      return {
        ok: !error,
        summary: error
          ? `execution ${execution.id} failed at ${error.node?.name ?? "unknown node"}: ${redact(error.message ?? "unknown error")}`
          : `execution ${execution.id} finished ${execution.status ?? (execution.finished ? "successfully" : "without a final status")}`,
        verifies: error ? [] : [BOUNDARIES.n8nExecution],
        blocker: error
          ? {
              boundary: BOUNDARIES.n8nExecution,
              kind: "execution_failure",
              detail: redact(error.message ?? "execution failed"),
            }
          : null,
        data: {
          id: execution.id,
          workflowId: execution.workflowId,
          status: execution.status ?? null,
          mode: execution.mode ?? null,
          startedAt: execution.startedAt ?? null,
          stoppedAt: execution.stoppedAt ?? null,
          failedNode: error?.node?.name ?? null,
          error: error ? redact(error.message ?? "execution failed") : null,
        },
      };
    },

    async validate_draft({ artifact }) {
      const errors = [];
      if (!artifact || typeof artifact !== "object") errors.push("draft must be an object");
      if (!Array.isArray(artifact?.nodes)) errors.push("draft.nodes must be an array");
      if (!artifact?.connections || typeof artifact.connections !== "object")
        errors.push("draft.connections must be an object");
      return {
        ok: errors.length === 0,
        summary: errors.length
          ? `invalid n8n draft: ${errors.join("; ")}`
          : `valid n8n draft with ${artifact.nodes.length} nodes`,
        data: { valid: errors.length === 0, errors },
      };
    },

    async apply_draft({ workflowId, artifact }) {
      requireMutations(allowMutations, "n8n.apply_draft");
      if (!workflowId || !artifact) throw new Error("workflowId and artifact are required");
      const updated = await request(`/workflows/${encodeURIComponent(workflowId)}`, {
        method: "PUT",
        body: artifact,
      });
      return {
        ok: true,
        summary: `updated n8n workflow draft ${updated.id ?? workflowId}`,
        data: { workflowId: updated.id ?? workflowId },
      };
    },

    async publish({ workflowId }) {
      requireMutations(allowMutations, "n8n.publish");
      if (!workflowId) throw new Error("workflowId is required");
      const updated = await request(`/workflows/${encodeURIComponent(workflowId)}/activate`, {
        method: "POST",
      });
      return {
        ok: updated?.active === true,
        summary: `workflow ${workflowId} ${updated?.active ? "activated" : "did not report active"}`,
        data: { workflowId, active: updated?.active === true },
      };
    },
  };
}
