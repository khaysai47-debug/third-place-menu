// Git inspection and isolated-workspace management.
//
// Inspection is read-only. Creation is deliberately the only place in the agent
// that writes to Git, and it writes exactly two things: a branch and a worktree.
// It never commits, never pushes, never merges, never deletes a branch that has
// work on it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

const gitRaw = (args, cwd = process.cwd()) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const git = (args, cwd = process.cwd()) => gitRaw(args, cwd).trim();

export const headCommit = (cwd) => git(["rev-parse", "HEAD"], cwd);

export const repoRoot = (cwd) => git(["rev-parse", "--show-toplevel"], cwd);

/** `git status --short` output, "" when the tree is clean. */
export const statusShort = (cwd) => git(["status", "--short"], cwd);

export const isClean = (cwd) => statusShort(cwd) === "";

/**
 * Is `head` an acceptable current commit for a task based on `baseCommit`?
 *
 * THE REGRESS THIS SOLVES
 *
 *   A task file is tracked, and its baseCommit is supposed to be HEAD. But
 *   committing the task file MOVES HEAD, so the task it just committed now
 *   names the previous commit. Set baseCommit to the new HEAD and commit again,
 *   and HEAD moves again. Strict equality can never be satisfied for a tracked
 *   task file — the flow "prepare task → commit task → approve" would be
 *   impossible.
 *
 * THE RULE
 *
 *   HEAD must be baseCommit, OR a descendant of it whose every changed file is
 *   under `project/` — the agent's own memory directory, which holds no
 *   application code. Committing a task specification, a decision record or a
 *   run report therefore does not invalidate the base it names. Committing a
 *   single line of `src/` does.
 *
 * @returns {{ ok: boolean, reason: string, drifted: string[] }}
 */
export function baseCommitAcceptable(baseCommit, head, cwd) {
  if (baseCommit === head) return { ok: true, reason: "HEAD is the base commit", drifted: [] };

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseCommit, head], {
      cwd,
      stdio: "ignore",
    });
  } catch {
    return {
      ok: false,
      reason: `base ${baseCommit} is not an ancestor of HEAD ${head}`,
      drifted: [],
    };
  }

  const changed = git(["diff", "--name-only", `${baseCommit}..${head}`], cwd)
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/\\/g, "/"));
  const drifted = changed.filter((f) => f !== "project" && !f.startsWith("project/"));

  if (drifted.length > 0) {
    return {
      ok: false,
      reason: `HEAD has moved past the base with non-project changes: ${drifted.slice(0, 5).join(", ")}`,
      drifted,
    };
  }
  return {
    ok: true,
    reason: `HEAD is ${changed.length} project-only commit(s) ahead of the base`,
    drifted: [],
  };
}

/** Does a local branch already exist? */
export function branchExists(name, cwd) {
  try {
    git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], cwd);
    return true;
  } catch {
    return false;
  }
}

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
export function planWorkspace(task, cwd) {
  const root = repoRoot(cwd);
  const branch = `agent/${task.taskId}-${slugify(task.title)}`;
  const worktree = path.join(
    path.dirname(root),
    `${path.basename(root)}-agent-worktrees`,
    task.taskId,
  );
  return { branch, worktree };
}

/** Registered worktree paths, normalized. */
export function listWorktrees(cwd) {
  return git(["worktree", "list", "--porcelain"], cwd)
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
export function worktreeState(worktreePath, cwd) {
  const resolved = path.resolve(worktreePath);
  const registered = listWorktrees(cwd).includes(resolved);
  if (registered) return "registered";
  return existsSync(resolved) ? "foreign" : "absent";
}

/**
 * Reject a worktree path that is inside the repository. An agent worktree must
 * live outside the main checkout, or the Builder's edits would show up as
 * changes to the human's working copy.
 */
export function assertOutsideRepo(worktreePath, root) {
  const rel = path.relative(path.resolve(root), path.resolve(worktreePath));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(`refusing worktree inside the repository: ${worktreePath}`);
  }
}

/**
 * Create the task branch and its isolated worktree.
 *
 * The branch is created FROM the approved base commit, not from whatever HEAD
 * happens to be — the preflight has already proven they are the same, and
 * naming the commit explicitly means a race cannot silently rebase the task.
 *
 * @returns {{ branch, worktree, linkedNodeModules: boolean }}
 */
export function createWorkspace({ branch, worktree, baseCommit, cwd = process.cwd() }) {
  const root = repoRoot(cwd);
  assertOutsideRepo(worktree, root);

  if (branchExists(branch, cwd)) throw new Error(`branch already exists: ${branch}`);
  if (existsSync(worktree)) throw new Error(`worktree path already exists: ${worktree}`);

  mkdirSync(path.dirname(worktree), { recursive: true });
  git(["worktree", "add", "-b", branch, worktree, baseCommit], cwd);

  // A fresh worktree has no node_modules, so checks could not run in it. Link
  // rather than install: same dependency tree, no network, no minutes lost.
  // ponytail: junction/symlink instead of a second `npm ci`.
  let linkedNodeModules = false;
  const source = path.join(root, "node_modules");
  const target = path.join(worktree, "node_modules");
  if (existsSync(source) && !existsSync(target)) {
    try {
      symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
      linkedNodeModules = true;
    } catch {
      // Not fatal: checks will report their own failure if deps are missing.
      linkedNodeModules = false;
    }
  }

  return { branch, worktree, linkedNodeModules };
}

/**
 * Remove a worktree and its branch. Only used by tests and by explicit cleanup —
 * a real run PRESERVES its worktree so a human can inspect the diff.
 */
export function removeWorkspace({ branch, worktree, cwd = process.cwd() }) {
  try {
    // Remove the node_modules link first so `git worktree remove` does not walk
    // into the shared dependency tree.
    const link = path.join(worktree, "node_modules");
    if (existsSync(link)) rmSync(link, { recursive: false, force: true });
  } catch {
    /* best effort */
  }
  try {
    git(["worktree", "remove", "--force", worktree], cwd);
  } catch {
    if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
  }
  try {
    git(["worktree", "prune"], cwd);
  } catch {
    /* best effort */
  }
  if (branch && branchExists(branch, cwd)) {
    try {
      git(["branch", "-D", branch], cwd);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Files the Builder changed inside its worktree, relative to the worktree root.
 * Covers tracked modifications and untracked new files; ignores node_modules,
 * which is a link into the main repository and is never the Builder's work.
 */
export function changedFiles(worktree) {
  // -z is NUL-separated and never quotes or escapes a path, so a filename with
  // a space, a quote or a non-ASCII character parses the same as any other.
  // Plain `--porcelain` would also lose the leading status space to trimming,
  // which silently ate the first character of every path.
  const records = gitRaw(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    worktree,
  ).split("\0");

  const files = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    const status = record.slice(0, 2);
    const file = record.slice(3);
    // A rename or copy is followed by its ORIGIN path in the next record;
    // consume it so it is not read as a change of its own.
    if (status[0] === "R" || status[0] === "C") i += 1;
    const clean = file.replace(/\\/g, "/");
    if (!clean) continue;
    if (clean === "node_modules" || clean.startsWith("node_modules/")) continue;
    files.push(clean);
  }
  return [...new Set(files)].sort();
}

/** Unified diff of everything the Builder changed, including untracked files. */
export function diffPatch(worktree) {
  // `git add --intent-to-add` makes untracked files visible to `git diff`
  // without staging content. It is the one index touch the engine makes, and it
  // happens only inside the isolated worktree, never in the main checkout.
  try {
    git(["add", "--intent-to-add", "--", "."], worktree);
  } catch {
    /* nothing to add */
  }
  return git(["diff", "--no-color"], worktree);
}
