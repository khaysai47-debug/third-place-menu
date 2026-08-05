// `agent:approve` — record a human's consent to one exact task, outside the
// repository.
//
// This command is deliberately tiny in effect: it reads, it checks, it writes
// ONE json file outside the repo. It creates no branch, no worktree, no commit,
// invokes no model, and leaves the working tree byte-for-byte unchanged.
import { approvalsDir, buildReceipt, hashTask, writeReceipt } from "./approval.mjs";
import { loadTask } from "./coordinator.mjs";
import { protectedActions, validateTask } from "./schemas.mjs";
import { baseCommitAcceptable, headCommit, statusShort } from "./workspace.mjs";

/**
 * Untracked run artifacts do not block approval.
 *
 * `project/runs/` accumulates reports from `agent:dry-run`, and requiring a
 * human to delete them before approving would be busywork that teaches people
 * to ignore the cleanliness check. Anything else — a modified tracked file, a
 * staged change, an untracked source file — does block, because the base commit
 * the approval binds to would not describe what is actually on disk.
 */
export const APPROVAL_DIRT_EXEMPTIONS = ["?? project/runs/"];

export function blockingDirt(status) {
  return status
    .split("\n")
    .filter(Boolean)
    .filter((line) => !APPROVAL_DIRT_EXEMPTIONS.some((prefix) => line.startsWith(prefix)));
}

/**
 * Approve a task.
 *
 * @returns {{ ok: boolean, status: string, detail: string, receiptFile?: string,
 *             taskHash?: string, receipt?: object, warnings: string[] }}
 */
export function approveTask(
  taskFile,
  {
    approvedBy,
    stateDir,
    repoRoot = process.cwd(),
    git = {
      headCommit: () => headCommit(repoRoot),
      statusShort: () => statusShort(repoRoot),
      baseCommitAcceptable: (base, head) => baseCommitAcceptable(base, head, repoRoot),
    },
    now = () => new Date(),
  } = {},
) {
  const warnings = [];
  const fail = (status, detail) => ({ ok: false, status, detail, warnings });

  if (typeof approvedBy !== "string" || approvedBy.trim() === "") {
    return fail("APPROVER_MISSING", "--by <name> is required: an approval needs a named human");
  }

  // 1. The task must be a valid specification.
  const { task, error } = loadTask(taskFile);
  if (error) return fail("INVALID_TASK", error);
  const validation = validateTask(task);
  warnings.push(...(validation.warnings ?? []));
  if (!validation.valid) return fail("INVALID_TASK", validation.errors.join("; "));

  // 2. A task requesting a protected operation is never approvable by this
  //    command — those need their own, separate human decision.
  const protectedRequests = protectedActions(task);
  if (protectedRequests.length > 0) {
    return fail(
      "BLOCKED_PERMISSION",
      `task requests protected operations (${protectedRequests.join(", ")}) — not approvable here`,
    );
  }

  // 3. The approval binds to a commit, so HEAD must already be that commit.
  let head;
  let status;
  try {
    head = git.headCommit();
    status = git.statusShort();
  } catch (gitError) {
    return fail("FAILED", `git inspection failed: ${gitError.message}`);
  }
  const acceptable = git.baseCommitAcceptable(task.baseCommit, head);
  if (!acceptable.ok) {
    return fail(
      "BASE_COMMIT_MISMATCH",
      `HEAD is ${head}, task baseCommit is ${task.baseCommit}: ${acceptable.reason}`,
    );
  }

  // 4. The tree must match that commit, or the approval would describe code
  //    that is not what is actually checked out.
  const dirt = blockingDirt(status);
  if (dirt.length > 0) {
    return fail(
      "DIRTY_REPOSITORY",
      `working tree has uncommitted changes:\n${dirt.map((l) => `  ${l}`).join("\n")}`,
    );
  }

  // 5. Write the receipt, atomically, outside the repository.
  const dir = approvalsDir({ stateDir, repoRoot });
  const receipt = buildReceipt({
    task,
    taskFile,
    approvedBy: approvedBy.trim(),
    approvedAt: now().toISOString(),
  });
  const receiptFile = writeReceipt(receipt, dir);

  return {
    ok: true,
    status: "APPROVED",
    detail: `approved by ${receipt.approvedBy}`,
    receiptFile,
    taskHash: hashTask(task),
    receipt,
    warnings,
  };
}
