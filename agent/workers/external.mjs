// External-system workers: n8n and Vercel.
//
// THIS FILE CONTAINS NO INTEGRATION. That is the point of it.
//
// It defines what an n8n or Vercel worker is ALLOWED to do, which of those
// things need a human, and the shape a real connector must implement to be wired
// in later. With no connector configured — the state today — every read-only
// capability answers `not_available`, and every change answers
// `requires_approval` without performing anything. Neither answer is ever a
// fabricated success: an orchestrator that reports "n8n workflow inspected" with
// no n8n connection is worse than one that cannot inspect at all.
//
// CONNECTOR CONTRACT
//
//   A connector is a plain object of async functions named after the worker's
//   Class A capabilities:
//
//     { async inspect_workflow({ workflowId, task, state }) → ConnectorResult }
//
//   ConnectorResult:
//     { ok: boolean,
//       summary: string,              // one line, no secret values, ever
//       data?: object,                // structured detail for the report
//       verifies?: string[],          // boundaries this call PROVED
//       blocker?: { boundary, kind, detail } }   // when ok is false
//
//   Connectors are injected, never imported: nothing in this repository knows an
//   n8n URL or a Vercel token, and nothing here should learn one.
import { hashArtifact, hashTarget } from "../action-approval.mjs";
import { assertNoSecretValues } from "../redact.mjs";
import { BOUNDARIES, blocked, evidence, failed, guard, notAvailable, ok } from "./contract.mjs";

/**
 * n8n. Reads are automatic when a connector exists; a draft may be proposed and
 * validated freely because a draft changes nothing; applying one is Class B and
 * PUBLISHING is Class B — a published workflow is live behaviour, and live
 * behaviour is a human's decision.
 */
export const N8N_CAPABILITIES = {
  inspect_workflow: {
    permission: "inspect_external_system",
    requiresGrant: true,
    requiredArgs: ["workflowId"],
    summary: "read a workflow definition",
  },
  inspect_execution: {
    permission: "inspect_external_system",
    requiresGrant: true,
    requiredArgs: ["executionId"],
    summary: "read one execution: which nodes ran, which failed, with what error",
  },
  validate_draft: {
    permission: "inspect_external_system",
    requiresGrant: true,
    summary: "check a proposed workflow draft against the receiving API contract",
  },
  propose_edit: {
    actionClass: "A",
    summary: "produce a draft edit as an artefact — changes nothing anywhere",
  },
  apply_draft: {
    permission: "n8n_change",
    summary: "write a draft into the workflow (Class B)",
  },
  publish: {
    permission: "n8n_change",
    summary: "publish a workflow so it takes live traffic (Class B)",
  },
};

/**
 * Vercel. Config and log reads are automatic with a connector; production
 * deployment and production environment values are Class C, always, and are
 * never performed by this agent under any configuration.
 */
export const VERCEL_CAPABILITIES = {
  inspect_deployments: {
    permission: "inspect_external_system",
    requiresGrant: true,
    summary: "list recent deployments and their state",
  },
  inspect_logs: {
    permission: "inspect_external_system",
    requiresGrant: true,
    summary: "read function/build logs for a deployment",
  },
  inspect_config: {
    permission: "inspect_external_system",
    requiresGrant: true,
    // PRESENCE, not value. A connector that returns an env VALUE is a bug in the
    // connector; redaction here is the second line of defence, not the first.
    summary: "check that required configuration and env vars are PRESENT (never their values)",
  },
  propose_config_change: {
    actionClass: "A",
    summary: "produce a proposed configuration change as an artefact",
  },
  apply_preview_config: {
    actionClass: "B",
    summary: "apply non-secret configuration to a preview environment (Class B)",
  },
  deploy_production: {
    permission: "production_deploy",
    summary: "deploy to production (Class C)",
  },
  set_production_env: {
    permission: "secret_rotation",
    summary: "create or change a production environment value (Class C)",
  },
};

/**
 * Build an external worker.
 *
 * @param {object}  spec
 * @param {string}  spec.name        worker id: "n8n" | "vercel"
 * @param {object}  spec.capabilities
 * @param {?object} spec.connector   injected; null means "not wired"
 * @param {string}  spec.boundary    boundary this worker reports against
 */
export function createExternalWorker({
  name,
  capabilities,
  connector = null,
  boundary,
  actionApprovalDir = null,
}) {
  return {
    name,
    capabilities,
    connected: Boolean(connector),

    async act({ action, task, state, args = {} }) {
      try {
        assertNoSecretValues(args);
      } catch (error) {
        return failed(name, action, error.message, { terminal: true });
      }
      const actionArgs = Object.fromEntries(
        Object.entries(args).filter(([key]) => key !== "artifact" && key !== "target"),
      );
      const refusal = guard({
        worker: name,
        action,
        task,
        capabilities,
        args: {
          ...args,
          // Never trust a caller-supplied target label. Bind approval to the
          // actual public action arguments and connector-owned resource id.
          target: { connector: connector?.approvalTarget ?? null, actionArgs },
        },
        actionApprovalDir,
      });
      if (refusal) return refusal;

      // Class A from here on: read-only, or a proposal that changes nothing.
      if (action.startsWith("propose_")) {
        if (!("artifact" in args)) {
          return failed(name, action, "a proposed action requires args.artifact");
        }
        return ok(name, action, {
          evidence: [
            evidence({
              worker: name,
              action,
              kind: "proposal",
              summary: `${name}.${action} produced immutable artefact ${hashArtifact(args.artifact)}`,
              payload: {
                artifactHash: hashArtifact(args.artifact),
                targetHash: hashTarget(args.target ?? null),
              },
            }),
          ],
          data: {
            artifactHash: hashArtifact(args.artifact),
            targetHash: hashTarget(args.target ?? null),
          },
        });
      }
      if (!connector) {
        return notAvailable(
          name,
          action,
          `no ${name} connector is configured — ${action} cannot be performed, and will not be simulated`,
          { suggestedNextWorker: null },
        );
      }
      if (typeof connector[action] !== "function") {
        return notAvailable(
          name,
          action,
          `the configured ${name} connector implements no "${action}" capability`,
        );
      }

      const missingArgs = (capabilities[action].requiredArgs ?? []).filter(
        (key) => args[key] === undefined || args[key] === null || args[key] === "",
      );
      if (missingArgs.length > 0) {
        return failed(
          name,
          action,
          `${name}.${action} requires public target argument(s): ${missingArgs.join(", ")}`,
          { terminal: true },
        );
      }

      let response;
      try {
        // Credentials stay in the connector closure. Task, state and prompts
        // are deliberately not passed across this boundary.
        response = await connector[action]({ ...args });
        assertNoSecretValues(response);
      } catch (error) {
        return failed(name, action, String(error?.message ?? error).split("\n")[0]);
      }

      if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
        return failed(
          name,
          action,
          `the ${name} connector returned a malformed result for ${action}`,
        );
      }

      const entries = [
        evidence({
          worker: name,
          action,
          kind: "inspection",
          summary: response.summary ?? `${name}.${action} returned`,
          payload: response.data ?? null,
        }),
      ];

      if (response.ok) {
        return ok(name, action, {
          evidence: entries,
          verifiedBoundariesAdded: response.verifies ?? [],
          data: response.data ?? null,
          changed: false,
        });
      }

      return blocked(
        name,
        action,
        response.blocker ?? {
          boundary,
          kind: `${name}_failure`,
          detail: response.summary ?? `${name}.${action} reported a problem`,
        },
        { evidence: entries, data: response.data ?? null },
      );
    },
  };
}

export const createN8nWorker = ({ connector = null, actionApprovalDir = null } = {}) =>
  createExternalWorker({
    name: "n8n",
    capabilities: N8N_CAPABILITIES,
    connector,
    boundary: BOUNDARIES.n8nExecution,
    actionApprovalDir,
  });

export const createVercelWorker = ({ connector = null, actionApprovalDir = null } = {}) =>
  createExternalWorker({
    name: "vercel",
    capabilities: VERCEL_CAPABILITIES,
    connector,
    boundary: BOUNDARIES.vercelDeployment,
    actionApprovalDir,
  });
