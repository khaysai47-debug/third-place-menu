// Coordinator: loads a task, gates it, and produces a run report.
//
// This bootstrap contains no Claude or Codex subprocess execution. The dry run
// is a pure inspection: it reads the repository and writes a report, nothing
// else.
//
// TWO DISTINCT GATES — see AGENTS.md "Draft validation vs. execution":
//
//   validate()          structural only. Never authorizes anything.
//   dryRun()            draft inspection. Never authorizes anything.
//   executionPreflight() the ONLY gate that may authorize work, and it reads
//                        every input fresh — the task file from disk, HEAD,
//                        the working tree, the worktree — every single time.
//
// A dry run does not "pre-clear" a later execution. Execution re-runs the whole
// preflight itself, and a stale READY_TO_RUN from ten minutes ago means nothing.
import { readFileSync } from "node:fs";
import { resolveChecks } from "./checks.mjs";
import { makeRunId, RUNS_DIR, writeReport } from "./report.mjs";
import { protectedActions, validateTask } from "./schemas.mjs";
import { headCommit, planWorkspace, statusShort, worktreeState } from "./workspace.mjs";

/** Statuses the CLI treats as a successful, controlled stop. */
export const OK_STATUSES = ["READY_TO_RUN", "READY_FOR_APPROVAL"];

/**
 * Live repository readers. The default is always the real repository; the seam
 * exists so agent/agent.test.mjs can drive every gate deterministically without
 * creating branches, worktrees or commits. Production callers never pass it.
 */
export const liveGit = { headCommit, statusShort, worktreeState };

/**
 * Read and parse a task file.
 *
 * @returns {{ task: object|null, error: string|null }}
 */
export function loadTask(taskFile) {
  try {
    return { task: JSON.parse(readFileSync(taskFile, "utf8")), error: null };
  } catch (error) {
    return { task: null, error: `could not read task ${taskFile}: ${error.message}` };
  }
}

/** Structural validation only — no repository, approval or permission gates. */
export function validate(taskFile) {
  const { task, error } = loadTask(taskFile);
  if (error) return { valid: false, errors: [error], task: null };
  const result = validateTask(task);
  return { ...result, task };
}

const gate = (name, ok, detail) => ({ name, ok, detail });

/**
 * The authorizing gate. Re-reads the task from disk and re-inspects the
 * repository; accepts no cached state from any earlier run.
 *
 * Every approved execution MUST call this immediately before doing work, and
 * again after any pause and resume. See project/PAUSE_RESUME.md.
 *
 * @returns {{ status, gates, task, validation, currentCommit, repositoryStatus,
 *             repositoryClean, workspace, worktreeState, protectedActions }}
 */
export function executionPreflight(taskFile, { git = liveGit } = {}) {
  const gates = [];
  const out = {
    status: "FAILED",
    gates,
    task: null,
    validation: { valid: false, errors: [] },
    currentCommit: null,
    repositoryStatus: null,
    repositoryClean: null,
    workspace: null,
    worktreeState: null,
    protectedActions: [],
  };

  // 1. Task, re-read from disk. Not the object a caller happens to be holding.
  const { task, error } = loadTask(taskFile);
  out.task = task;
  out.validation = error ? { valid: false, errors: [error] } : validateTask(task);
  gates.push(gate("task_valid", out.validation.valid, out.validation.errors.join("; ") || "ok"));
  if (!out.validation.valid) return { ...out, status: "INVALID_TASK" };

  // 2. Protected permissions, re-derived from the file just read.
  out.protectedActions = protectedActions(task);
  const noProtected = out.protectedActions.length === 0;
  gates.push(gate("no_protected_actions", noProtected, out.protectedActions.join(", ") || "none"));
  if (!noProtected) return { ...out, status: "BLOCKED_PERMISSION" };

  // 3. Approval, re-read from the file. An execution never trusts an earlier
  //    "it was approved when we planned it".
  const approved = task.approved === true;
  gates.push(gate("approved", approved, approved ? `by ${task.approvedBy}` : "not approved"));
  if (!approved) return { ...out, status: "READY_FOR_APPROVAL" };

  // 4. Live HEAD vs. the task's expected base commit.
  try {
    out.currentCommit = git.headCommit();
    out.repositoryStatus = git.statusShort();
  } catch (gitError) {
    gates.push(gate("git_readable", false, gitError.message));
    return { ...out, status: "FAILED" };
  }
  out.repositoryClean = out.repositoryStatus === "";

  const onBase = out.currentCommit === task.baseCommit;
  gates.push(gate("base_commit", onBase, `HEAD ${out.currentCommit} vs base ${task.baseCommit}`));
  if (!onBase) return { ...out, status: "BASE_COMMIT_MISMATCH" };

  // 5. Working tree cleanliness.
  gates.push(gate("clean_tree", out.repositoryClean, out.repositoryClean ? "clean" : "dirty"));
  if (!out.repositoryClean) return { ...out, status: "DIRTY_REPOSITORY" };

  // 6. Workspace / worktree state.
  out.workspace = planWorkspace(task);
  out.worktreeState = git.worktreeState(out.workspace.worktree);
  const worktreeOk = out.worktreeState !== "foreign";
  gates.push(gate("worktree", worktreeOk, `${out.workspace.worktree} is ${out.worktreeState}`));
  if (!worktreeOk) return { ...out, status: "WORKTREE_CONFLICT" };

  return { ...out, status: "READY_TO_RUN" };
}

/**
 * Inspect a task against the current repository and write a run report.
 * Makes no Git changes whatsoever, and authorizes nothing.
 */
export function dryRun(taskFile, { git = liveGit, runsDir = RUNS_DIR } = {}) {
  const timestamp = new Date().toISOString();
  const { task, error } = loadTask(taskFile);
  const validation = error ? { valid: false, errors: [error] } : validateTask(task);
  const taskId = task?.taskId ?? "UNKNOWN";

  const report = {
    runId: makeRunId(taskId, timestamp),
    taskId,
    taskFile,
    timestamp,
    mode: "dry-run",
    authorizes: false,
    baseCommit: task?.baseCommit ?? null,
    currentCommit: null,
    repositoryStatus: null,
    repositoryClean: null,
    validation,
    approval: { approved: task?.approved === true, approvedBy: task?.approvedBy ?? null },
    proposedBranch: null,
    proposedWorktree: null,
    worktreeState: null,
    requiredChecks: [],
    checkResults: [],
    protectedActions: [],
    executionGates: [],
    notes: [],
    finalStatus: "FAILED",
  };

  try {
    report.currentCommit = git.headCommit();
    report.repositoryStatus = git.statusShort();
    report.repositoryClean = report.repositoryStatus === "";
  } catch (gitError) {
    report.notes.push(`git inspection failed: ${gitError.message}`);
    return finish(report, runsDir);
  }

  if (!validation.valid) {
    report.finalStatus = "INVALID_TASK";
    return finish(report, runsDir);
  }

  const { checks, unsupported } = resolveChecks(task);
  report.requiredChecks = checks;
  for (const name of unsupported) report.notes.push(`unsupported check ignored: ${name}`);

  report.protectedActions = protectedActions(task);
  if (report.protectedActions.length > 0) {
    report.notes.push("task requests operations the local runner may never perform on its own");
    report.finalStatus = "BLOCKED_PERMISSION";
    return finish(report, runsDir);
  }

  const workspace = planWorkspace(task);
  report.proposedBranch = workspace.branch;
  report.proposedWorktree = workspace.worktree;

  // Draft rules: an unapproved task is waiting on a human, not on a clean tree.
  // It stops here without ever touching the execution gate.
  if (!report.approval.approved) {
    report.notes.push("task is not approved — no work may start");
    report.finalStatus = "READY_FOR_APPROVAL";
    return finish(report, runsDir);
  }

  // Approved: run the real execution gate, fresh. Its verdict is this report's
  // verdict — but the report does NOT carry that authorization forward. An
  // execution must run the preflight again for itself.
  const preflight = executionPreflight(taskFile, { git });
  report.executionGates = preflight.gates;
  report.worktreeState = preflight.worktreeState;
  report.finalStatus = preflight.status;
  report.notes.push("execution preflight is advisory here — execution must re-run it");
  for (const failed of preflight.gates.filter((g) => !g.ok)) {
    report.notes.push(`gate ${failed.name}: ${failed.detail}`);
  }
  return finish(report, runsDir);
}

function finish(report, runsDir = RUNS_DIR) {
  const paths = writeReport(report, runsDir);
  return { report, paths };
}
