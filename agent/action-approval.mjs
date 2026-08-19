// Action-specific approval receipts for V2.1.
//
// A task receipt authorizes contained implementation. An action receipt is a
// separate, narrower decision: one named human approves one exact external
// action, against one exact target and one immutable artefact hash. Changing
// the artefact, target, task, worker or action produces a different request
// hash and the receipt cannot be reused.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { approvalsDir, hashTask } from "./approval.mjs";

export const ACTION_APPROVAL_VERSION = 1;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const digest = (value) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;

export const hashArtifact = (artifact) => digest(artifact ?? null);
export const hashTarget = (target) => digest(target ?? null);

/** Build the public, immutable action request stored in orchestration state. */
export function buildActionRequest({
  task,
  worker,
  action,
  actionClass,
  permission,
  target,
  artifact,
}) {
  const request = {
    requestVersion: ACTION_APPROVAL_VERSION,
    taskId: task.taskId,
    taskHash: hashTask(task),
    baseCommit: task.baseCommit,
    worker,
    action,
    actionClass,
    permission: permission ?? null,
    targetHash: hashTarget(target),
    artifactHash: hashArtifact(artifact),
  };
  return { ...request, actionHash: digest(request) };
}

export function actionApprovalsDir({
  stateDir,
  stateRoot,
  repoRoot = process.cwd(),
  env = process.env,
} = {}) {
  if (stateRoot && !stateDir) return path.join(path.resolve(stateRoot), "approvals", "actions");
  return path.join(approvalsDir({ stateDir, repoRoot, env }), "actions");
}

export const actionReceiptPath = (request, dir) =>
  path.join(dir, request.taskId, `${request.actionHash.replace(/^sha256:/, "")}.json`);

export function buildActionReceipt({ request, approvedBy, approvedAt = new Date().toISOString() }) {
  return {
    approvalVersion: ACTION_APPROVAL_VERSION,
    ...request,
    approvedBy,
    approvedAt,
  };
}

export function writeActionReceipt(receipt, dir) {
  const file = actionReceiptPath(receipt, dir);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(temp, file);
  return file;
}

export function verifyActionApproval({ request, dir, now = new Date() }) {
  const file = actionReceiptPath(request, dir);
  if (!existsSync(file)) {
    return { status: "ACTION_APPROVAL_MISSING", receipt: null, receiptFile: file };
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      status: "ACTION_APPROVAL_INVALID",
      receipt: null,
      receiptFile: file,
      detail: `receipt unreadable: ${error.message}`,
    };
  }
  const invalid = (detail) => ({
    status: "ACTION_APPROVAL_INVALID",
    receipt,
    receiptFile: file,
    detail,
  });
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return invalid("receipt is not an object");
  }
  if (receipt.approvalVersion !== ACTION_APPROVAL_VERSION) {
    return invalid(`unsupported approvalVersion ${receipt.approvalVersion}`);
  }
  if (typeof receipt.approvedBy !== "string" || !receipt.approvedBy.trim()) {
    return invalid("approvedBy is missing");
  }
  const approvedAt = new Date(receipt.approvedAt);
  if (Number.isNaN(approvedAt.getTime()) || approvedAt.getTime() > now.getTime() + 60_000) {
    return invalid("approvedAt is invalid or in the future");
  }
  for (const [key, value] of Object.entries(request)) {
    if (receipt[key] !== value) {
      return {
        status: "ACTION_APPROVAL_STALE",
        receipt,
        receiptFile: file,
        detail: `${key} changed after approval`,
      };
    }
  }
  return {
    status: "ACTION_APPROVED",
    receipt,
    receiptFile: file,
    detail: `approved by ${receipt.approvedBy}`,
  };
}
