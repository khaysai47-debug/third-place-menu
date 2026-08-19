import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildActionReceipt,
  buildActionRequest,
  verifyActionApproval,
  writeActionReceipt,
} from "./action-approval.mjs";
import { approvePendingAction } from "./approve-action.mjs";
import {
  configuredConnectors,
  createN8nConnector,
  createVercelConnector,
  mutationsEnabled,
} from "./connectors/index.mjs";
import { createN8nWorker, createVercelWorker } from "./workers/external.mjs";

const TASK = {
  taskId: "ATLAS-V21-TEST",
  title: "V2.1 test",
  objective: "test connector boundaries",
  context: "unit test",
  owner: "Atlas",
  baseCommit: "a".repeat(40),
  riskLevel: "low",
  allowedPaths: ["agent/"],
  forbiddenPaths: [],
  acceptanceCriteria: ["connectors are safe"],
  requiredChecks: ["typecheck"],
  permissions: ["inspect_external_system"],
  stoppingRules: ["stop on failure"],
};

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("action receipts bind task, action, target and immutable artifact hash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-action-"));
  const original = buildActionRequest({
    task: TASK,
    worker: "n8n",
    action: "apply_draft",
    actionClass: "B",
    permission: "n8n_change",
    target: { workflowId: "wf-1" },
    artifact: { name: "v1", nodes: [] },
  });
  writeActionReceipt(buildActionReceipt({ request: original, approvedBy: "Human" }), dir);
  assert.equal(verifyActionApproval({ request: original, dir }).status, "ACTION_APPROVED");

  const changedArtifact = buildActionRequest({
    task: TASK,
    worker: "n8n",
    action: "apply_draft",
    actionClass: "B",
    permission: "n8n_change",
    target: { workflowId: "wf-1" },
    artifact: { name: "v2", nodes: [] },
  });
  assert.notEqual(changedArtifact.artifactHash, original.artifactHash);
  assert.equal(
    verifyActionApproval({ request: changedArtifact, dir }).status,
    "ACTION_APPROVAL_MISSING",
  );

  const changedTarget = buildActionRequest({
    task: TASK,
    worker: "n8n",
    action: "apply_draft",
    actionClass: "B",
    permission: "n8n_change",
    target: { workflowId: "wf-2" },
    artifact: { name: "v1", nodes: [] },
  });
  assert.notEqual(changedTarget.actionHash, original.actionHash);
  assert.equal(
    verifyActionApproval({ request: changedTarget, dir }).status,
    "ACTION_APPROVAL_MISSING",
  );
});

test("approvePendingAction writes one named receipt but performs no action", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-action-"));
  const request = buildActionRequest({
    task: TASK,
    worker: "vercel",
    action: "deploy_production",
    actionClass: "C",
    permission: "production_deploy",
    target: { projectId: "p1" },
    artifact: { gitSource: { ref: "abc" } },
  });
  const state = {
    approvalsPending: [
      { worker: "vercel", action: "deploy_production", actionClass: "C", request },
    ],
  };
  const result = approvePendingAction({
    state,
    action: "vercel.deploy_production",
    approvedBy: "Human",
    dir,
  });
  assert.equal(result.ok, true);
  assert.equal(verifyActionApproval({ request, dir }).status, "ACTION_APPROVED");
});

test("protected connector action is unreachable before its exact receipt", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-action-"));
  let calls = 0;
  const worker = createN8nWorker({
    actionApprovalDir: dir,
    connector: {
      apply_draft: async () => {
        calls += 1;
        return { ok: true, summary: "draft applied" };
      },
    },
  });
  const args = {
    workflowId: "wf-1",
    target: { workflowId: "wf-1" },
    artifact: { name: "draft", nodes: [], connections: {} },
  };
  const queued = await worker.act({ action: "apply_draft", task: TASK, args });
  assert.equal(queued.status, "requires_approval");
  assert.equal(calls, 0);
  writeActionReceipt(
    buildActionReceipt({ request: queued.requiresApproval.request, approvedBy: "Human" }),
    dir,
  );
  const applied = await worker.act({ action: "apply_draft", task: TASK, args });
  assert.equal(applied.status, "success");
  assert.equal(calls, 1);

  const redirected = await worker.act({
    action: "apply_draft",
    task: TASK,
    args: { ...args, workflowId: "wf-2", target: { workflowId: "wf-1" } },
  });
  assert.equal(redirected.status, "requires_approval");
  assert.equal(calls, 1, "a stale caller-supplied target cannot redirect an approved action");

  const changed = await worker.act({
    action: "apply_draft",
    task: TASK,
    args: { ...args, artifact: { ...args.artifact, name: "changed" } },
  });
  assert.equal(changed.status, "requires_approval");
  assert.equal(calls, 1);
});

test("proposals are local immutable artifacts and require no connector", async () => {
  const worker = createN8nWorker();
  const result = await worker.act({
    action: "propose_edit",
    task: TASK,
    args: { target: { workflowId: "wf-1" }, artifact: { nodes: [], connections: {} } },
  });
  assert.equal(result.status, "success");
  assert.match(result.data.artifactHash, /^sha256:/);
  assert.equal(result.changed, false);
});

test("read permission is enforced before a configured connector can run", async () => {
  let calls = 0;
  const worker = createVercelWorker({
    connector: {
      inspect_deployments: async () => {
        calls += 1;
        return { ok: true, summary: "read" };
      },
    },
  });
  const result = await worker.act({
    action: "inspect_deployments",
    task: { ...TASK, permissions: [] },
  });
  assert.equal(result.status, "not_permitted");
  assert.equal(calls, 0);
});

test("secret-bearing worker args are refused and never reach a connector", async () => {
  let calls = 0;
  const worker = createVercelWorker({
    connector: {
      inspect_deployments: async () => {
        calls += 1;
        return { ok: true, summary: "read" };
      },
    },
  });
  const result = await worker.act({
    action: "inspect_deployments",
    task: TASK,
    args: { token: "sk-live-ABCDEF1234567890" },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.terminal, true);
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(result), /ABCDEF1234567890/);
});

test("n8n connector owns its API key and returns only sanitized workflow shape", async () => {
  const apiKey = "n8n-private-key-123456";
  let header;
  const connector = createN8nConnector({
    baseUrl: "https://n8n.example",
    apiKey,
    fetchImpl: async (_url, init) => {
      header = init.headers["X-N8N-API-KEY"];
      return response({
        id: "wf-1",
        name: "Atlas",
        active: true,
        nodes: [
          { id: "n1", name: "Webhook", type: "webhook", parameters: { token: "must-not-return" } },
        ],
      });
    },
  });
  const result = await connector.inspect_workflow({ workflowId: "wf-1" });
  assert.equal(header, apiKey, "the connector uses its private closure for auth");
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /n8n-private|must-not-return/);
  assert.deepEqual(result.data.nodes[0], {
    id: "n1",
    name: "Webhook",
    type: "webhook",
    disabled: false,
  });
});

test("Vercel config inspection reports presence and never returns env values", async () => {
  const secret = "vercel-secret-token-123";
  const connector = createVercelConnector({
    token: secret,
    projectId: "prj_1",
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, `Bearer ${secret}`);
      return response({
        envs: [
          { key: "PAYMENT_URL", value: "https://private.example" },
          { key: "API_SECRET", value: "top-secret" },
        ],
      });
    },
  });
  const result = await connector.inspect_config({ requiredKeys: ["PAYMENT_URL", "MISSING"] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.data.present, { PAYMENT_URL: true, MISSING: false });
  assert.doesNotMatch(JSON.stringify(result), /private\.example|top-secret|vercel-secret/);
});

test("connector HTTP failures are honest, redacted worker failures", async () => {
  const connector = createN8nConnector({
    baseUrl: "https://n8n.example",
    apiKey: "private",
    fetchImpl: async () =>
      response({ message: "Authorization: Bearer sk-live-ABCDEF1234567890" }, 401),
  });
  const worker = createN8nWorker({ connector });
  const result = await worker.act({
    action: "inspect_workflow",
    task: TASK,
    args: { workflowId: "wf-1" },
  });
  assert.equal(result.status, "failed");
  assert.match(result.blocker.detail, /redacted/);
  assert.doesNotMatch(JSON.stringify(result), /ABCDEF1234567890/);
});

test("real connectors are honestly unavailable without required configuration", () => {
  assert.equal(createN8nConnector({ env: {} }), null);
  assert.equal(createVercelConnector({ env: {} }), null);
});

test("mutation kill switch remains closed even after action approval", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-action-"));
  let networkCalls = 0;
  const connector = createN8nConnector({
    baseUrl: "https://n8n.example",
    apiKey: "private",
    allowMutations: false,
    fetchImpl: async () => {
      networkCalls += 1;
      return response({ id: "wf-1" });
    },
  });
  const worker = createN8nWorker({ connector, actionApprovalDir: dir });
  const args = {
    workflowId: "wf-1",
    target: { workflowId: "wf-1" },
    artifact: { nodes: [], connections: {} },
  };
  const queued = await worker.act({ action: "apply_draft", task: TASK, args });
  writeActionReceipt(
    buildActionReceipt({ request: queued.requiresApproval.request, approvedBy: "Human" }),
    dir,
  );
  const result = await worker.act({ action: "apply_draft", task: TASK, args });
  assert.equal(result.status, "failed");
  assert.match(result.blocker.detail, /disabled/);
  assert.equal(networkCalls, 0);
});

test("the two mutation gates are independent, and both default to DENY", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-action-"));
  const env = { ATLAS_N8N_URL: "https://n8n.example", ATLAS_N8N_API_KEY: "private" };
  let networkCalls = 0;
  const fetchImpl = async () => {
    networkCalls += 1;
    return response({ id: "wf-1" });
  };
  const args = {
    workflowId: "wf-1",
    target: { workflowId: "wf-1" },
    artifact: { nodes: [], connections: {} },
  };

  // Gate 2 shut: the runtime switch is absent, so nothing configured here can
  // mutate, receipt or no receipt.
  assert.equal(mutationsEnabled(env), false);
  const shut = configuredConnectors({ env, fetchImpl });
  await assert.rejects(
    () => shut.n8n.apply_draft({ workflowId: "wf-1", artifact: args.artifact }),
    /disabled in the default Atlas runtime/,
  );

  // Gate 2 open, gate 1 shut: an explicit runtime switch authorizes nothing on
  // its own — the exact receipt is still missing.
  const open = configuredConnectors({ env: { ...env, ATLAS_ALLOW_MUTATIONS: "1" }, fetchImpl });
  const worker = createN8nWorker({ connector: open.n8n, actionApprovalDir: dir });
  const queued = await worker.act({ action: "apply_draft", task: TASK, args });
  assert.equal(queued.status, "requires_approval");
  assert.equal(networkCalls, 0, "neither gate on its own reaches the network");
});
