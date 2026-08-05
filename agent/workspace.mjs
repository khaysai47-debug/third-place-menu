// Git inspection and workspace planning. Read-only by design: nothing here
// creates a branch, a worktree, a commit or a remote reference. The dry run
// only ever *proposes* names.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

export const headCommit = () => git("rev-parse", "HEAD");

export const repoRoot = () => git("rev-parse", "--show-toplevel");

/** `git status --short` output, "" when the tree is clean. */
export const statusShort = () => git("status", "--short");

export const isClean = () => statusShort() === "";

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

/**
 * Proposed (not created) isolated workspace for a task.
 *
 * The worktree lives beside the repository so the checkout it would occupy can
 * never collide with the human's working copy.
 */
export function planWorkspace(task) {
  const root = repoRoot();
  const branch = `agent/${task.taskId}-${slugify(task.title)}`;
  const worktree = path.join(
    path.dirname(root),
    `${path.basename(root)}-agent-worktrees`,
    task.taskId,
  );
  return { branch, worktree };
}

/** Registered worktree paths, normalized. */
export function listWorktrees() {
  return git("worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()));
}

/**
 * State of a planned worktree path, checked fresh from disk and from Git.
 *
 * - `absent`     — nothing there. Expected before the first execution.
 * - `registered` — a Git worktree the runner previously created. Resumable.
 * - `foreign`    — the path exists but Git does not know it. Never touch it.
 */
export function worktreeState(worktreePath) {
  const resolved = path.resolve(worktreePath);
  const registered = listWorktrees().includes(resolved);
  if (registered) return "registered";
  return existsSync(resolved) ? "foreign" : "absent";
}
