// External approval receipts.
//
// THE MODEL
//
//   The tracked task file is an immutable SPECIFICATION. It says what should be
//   done. It never says "yes, do it".
//
//   Approval is a separate RECEIPT, written outside the repository, that binds
//   one approver to one exact task content at one exact base commit. Approving
//   therefore leaves the repository untouched: no file changes, no dirty tree,
//   no new commit, no moved HEAD, no base-commit mismatch.
//
//   Change the task by one character and its hash changes, so the receipt no
//   longer describes it and execution is refused as APPROVAL_STALE. That is the
//   point: approval is consent to a specific thing, not a standing permission.
//
// Receipts contain no secrets — a task id, a file path, a hash, a commit, a
// name and a timestamp. Nothing in one is confidential.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const APPROVAL_VERSION = 1;

/** Fields that used to live in the task file. Tracked approval is dead. */
export const DEPRECATED_TASK_FIELDS = ["approved", "approvedAt", "approvedBy"];

/**
 * Where receipts live: beside the repository, never inside it.
 *
 * Precedence: explicit argument → ATLAS_AGENT_STATE_DIR → sibling directory.
 * The sibling default means a fresh clone works with no configuration, and the
 * path is derived from the repo name so two checkouts cannot share receipts.
 */
export function approvalsDir({ stateDir, repoRoot = process.cwd(), env = process.env } = {}) {
  if (stateDir) return path.resolve(stateDir);
  if (env.ATLAS_AGENT_STATE_DIR)
    return path.join(path.resolve(env.ATLAS_AGENT_STATE_DIR), "approvals");
  const root = path.resolve(repoRoot);
  return path.join(path.dirname(root), `${path.basename(root)}-agent-state`, "approvals");
}

export const receiptPath = (taskId, dir) => path.join(dir, `${taskId}.json`);

/* ── Canonical hashing ───────────────────────────────────────────────────── */

/**
 * Deterministic JSON: keys sorted at every level, arrays kept in order because
 * their order is meaningful (allowedPaths, acceptanceCriteria).
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/**
 * SHA-256 over the canonical task specification.
 *
 * Deprecated approval fields are stripped before hashing, so removing a
 * leftover `"approved": false` from a task file does NOT invalidate a receipt —
 * the specification is unchanged, only the dead field is gone. Reformatting,
 * reordering keys or changing indentation likewise do not change the hash;
 * changing any actual instruction does.
 */
export function hashTask(task) {
  const spec = { ...task };
  for (const field of DEPRECATED_TASK_FIELDS) delete spec[field];
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(spec)))
    .digest("hex")}`;
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

/**
 * Build a receipt. Pure — the caller decides whether to persist it.
 */
export function buildReceipt({
  task,
  taskFile,
  approvedBy,
  approvedAt = new Date().toISOString(),
}) {
  return {
    approvalVersion: APPROVAL_VERSION,
    taskId: task.taskId,
    taskFile: taskFile.replace(/\\/g, "/"),
    taskHash: hashTask(task),
    baseCommit: task.baseCommit,
    approvedBy,
    approvedAt,
  };
}

/** Write a receipt atomically: temp file in the same directory, then rename. */
export function writeReceipt(receipt, dir) {
  mkdirSync(dir, { recursive: true });
  const file = receiptPath(receipt.taskId, dir);
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(temp, file);
  return file;
}

/** Read a receipt. Returns null when there is none; throws only on unreadable. */
export function readReceipt(taskId, dir) {
  const file = receiptPath(taskId, dir);
  if (!existsSync(file)) return null;
  return { raw: readFileSync(file, "utf8"), file };
}

/* ── Verification ────────────────────────────────────────────────────────── */

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Verify a stored receipt against the task as it exists on disk right now.
 *
 * Status mapping:
 *   APPROVAL_MISSING — no receipt at all. Nobody has approved this task.
 *   APPROVAL_INVALID — the receipt cannot be trusted: unreadable, unknown
 *                      version, missing or malformed field, wrong task id,
 *                      missing approver, unparseable or future timestamp.
 *   APPROVAL_STALE   — the receipt is well formed but no longer describes this
 *                      task: the content hash moved (the task was edited after
 *                      approval) or it was approved against a different base
 *                      commit.
 *
 * @returns {{ status: "APPROVED"|"APPROVAL_MISSING"|"APPROVAL_INVALID"|"APPROVAL_STALE",
 *             receipt: object|null, detail: string, receiptFile: string|null }}
 */
export function verifyApproval({ task, dir, now = new Date() }) {
  const file = receiptPath(task.taskId, dir);
  let stored;
  try {
    stored = readReceipt(task.taskId, dir);
  } catch (error) {
    return {
      status: "APPROVAL_INVALID",
      receipt: null,
      receiptFile: file,
      detail: `receipt unreadable: ${error.message}`,
    };
  }
  if (!stored) {
    return {
      status: "APPROVAL_MISSING",
      receipt: null,
      receiptFile: file,
      detail: `no approval receipt at ${file} — run agent:approve`,
    };
  }

  let receipt;
  try {
    receipt = JSON.parse(stored.raw);
  } catch (error) {
    return {
      status: "APPROVAL_INVALID",
      receipt: null,
      receiptFile: file,
      detail: `receipt is not valid JSON: ${error.message}`,
    };
  }
  const invalid = (detail) => ({ status: "APPROVAL_INVALID", receipt, receiptFile: file, detail });

  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    return invalid("receipt is not an object");
  }
  if (receipt.approvalVersion !== APPROVAL_VERSION) {
    return invalid(`unsupported approvalVersion ${receipt.approvalVersion}`);
  }
  for (const field of [
    "taskId",
    "taskFile",
    "taskHash",
    "baseCommit",
    "approvedBy",
    "approvedAt",
  ]) {
    if (!isNonEmptyString(receipt[field]))
      return invalid(`receipt field ${field} is missing or empty`);
  }
  if (receipt.taskId !== task.taskId) {
    return invalid(`receipt is for task ${receipt.taskId}, not ${task.taskId}`);
  }

  const approvedAt = new Date(receipt.approvedAt);
  if (Number.isNaN(approvedAt.getTime())) return invalid(`approvedAt is not a valid timestamp`);
  // A receipt dated in the future is either a clock problem or a forgery
  // attempt. Either way it is not evidence a human approved anything.
  if (approvedAt.getTime() > now.getTime() + 60_000) {
    return invalid("approvedAt is in the future");
  }

  // Well formed from here on: any mismatch means the world moved, not that the
  // receipt is bogus.
  const stale = (detail) => ({ status: "APPROVAL_STALE", receipt, receiptFile: file, detail });

  if (receipt.baseCommit !== task.baseCommit) {
    return stale(`approved against base ${receipt.baseCommit}, task now says ${task.baseCommit}`);
  }
  const currentHash = hashTask(task);
  if (receipt.taskHash !== currentHash) {
    return stale(`task changed after approval (${receipt.taskHash} → ${currentHash})`);
  }

  return {
    status: "APPROVED",
    receipt,
    receiptFile: file,
    detail: `approved by ${receipt.approvedBy}`,
  };
}
