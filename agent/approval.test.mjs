// External approval tests. Run with `npm run agent:test`.
//
// Receipts are written to temp directories OUTSIDE the temp repository, and the
// temp repository is a throwaway `git init` — the Atlas repository is never
// touched. No test invokes Claude, Codex, the network, push or deploy.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  APPROVAL_VERSION,
  approvalsDir,
  buildReceipt,
  hashTask,
  receiptPath,
  verifyApproval,
  writeReceipt,
} from "./approval.mjs";
import { approveTask, blockingDirt } from "./approve.mjs";
import { executionPreflight, liveGitAt } from "./coordinator.mjs";
import { createWorkspace, isControlPlanePath, planWorkspace, worktreeState } from "./workspace.mjs";
import { runTask } from "./engine.mjs";
import { validateTask } from "./schemas.mjs";

const SPEC = {
  taskId: "TEST-APPROVAL",
  title: "Approval fixture",
  objective: "Exercise the approval flow.",
  context: "Fixture only.",
  owner: "claude-builder",
  riskLevel: "low",
  allowedPaths: ["src/"],
  forbiddenPaths: ["api/"],
  acceptanceCriteria: ["Nothing real happens."],
  requiredChecks: ["typecheck"],
  permissions: ["read_repository", "run_checks"],
  stoppingRules: ["Stop on anything unexpected."],
};

const boxes = [];
afterEach(() => {
  while (boxes.length) rmSync(boxes.pop(), { recursive: true, force: true });
});

/** A throwaway git repository plus a state directory OUTSIDE it. */
function sandbox({ task = {}, dirty = false, extraUntracked = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-approval-"));
  boxes.push(dir);
  const repo = path.join(dir, "repo");
  const state = path.join(dir, "state", "approvals");
  mkdirSync(path.join(repo, "src"), { recursive: true });

  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Approval Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "src", "seed.ts"), "export const seed = 1;\n");

  // Exactly the documented real flow:
  //   1. commit the source state            -> this is the base commit
  //   2. write the task naming that base
  //   3. commit the task under project/     -> HEAD moves, but project-only
  git("add", "-A");
  git("commit", "--quiet", "-m", "seed");
  const baseCommit = git("rev-parse", "HEAD");

  const spec = { ...SPEC, baseCommit, ...task };
  mkdirSync(path.join(repo, "project", "tasks"), { recursive: true });
  const taskFile = path.join(repo, "project", "tasks", `${spec.taskId}.json`);
  writeFileSync(taskFile, JSON.stringify(spec, null, 2));
  git("add", "-A");
  git("commit", "--quiet", "-m", "add task specification");

  if (dirty) writeFileSync(path.join(repo, "src", "seed.ts"), "export const seed = 2;\n");
  if (extraUntracked) {
    const target = path.join(repo, extraUntracked);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "artifact\n");
  }

  return {
    dir,
    repo,
    state,
    taskFile,
    task: JSON.parse(readFileSync(taskFile, "utf8")),
    baseCommit,
    git,
    approve: (opts = {}) =>
      approveTask(taskFile, {
        approvedBy: "Sai Sai Khay",
        stateDir: state,
        repoRoot: repo,
        git: liveGitAt(repo),
        ...opts,
      }),
    preflight: ({ expectWorktree = false } = {}) =>
      executionPreflight(taskFile, {
        git: liveGitAt(repo),
        expectWorktree,
        stateDir: state,
        repoRoot: repo,
      }),
    /** Move HEAD past the base commit by writing and committing files. */
    commit: (files, message) => {
      for (const [rel, content] of Object.entries(files)) {
        const target = path.join(repo, rel);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
      git("add", "-A");
      git("commit", "--quiet", "-m", message);
      return git("rev-parse", "HEAD");
    },
    edit: (patch) => {
      const current = JSON.parse(readFileSync(taskFile, "utf8"));
      writeFileSync(taskFile, JSON.stringify({ ...current, ...patch }, null, 2));
    },
  };
}

/* ── Hashing ─────────────────────────────────────────────────────────────── */

test("task hash is stable across formatting and key order", () => {
  const a = { ...SPEC, baseCommit: "a".repeat(40) };
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(hashTask(a), hashTask(reordered));
  assert.equal(hashTask(a), hashTask(JSON.parse(JSON.stringify(a, null, 4))));
  assert.match(hashTask(a), /^sha256:[0-9a-f]{64}$/);
});

test("task hash changes when any instruction changes", () => {
  const a = { ...SPEC, baseCommit: "a".repeat(40) };
  assert.notEqual(hashTask(a), hashTask({ ...a, allowedPaths: ["src/", "api/"] }));
  assert.notEqual(hashTask(a), hashTask({ ...a, objective: "something else" }));
  assert.notEqual(hashTask(a), hashTask({ ...a, acceptanceCriteria: ["different"] }));
});

test("deprecated approval fields are excluded from the hash", () => {
  const a = { ...SPEC, baseCommit: "a".repeat(40) };
  // Removing a leftover `approved: false` must not invalidate a live receipt.
  assert.equal(
    hashTask(a),
    hashTask({ ...a, approved: false, approvedAt: null, approvedBy: null }),
  );
});

test("the default approvals directory is outside the repository", () => {
  const repoRoot = path.join(path.sep, "tmp", "some-repo");
  const dir = approvalsDir({ repoRoot, env: {} });
  assert.ok(!dir.startsWith(path.resolve(repoRoot) + path.sep), `${dir} must be outside the repo`);
  assert.match(dir, /some-repo-agent-state[\\/]approvals$/);
  // Environment override still lands outside whatever repo is in play.
  const elsewhere = path.join(path.sep, "elsewhere");
  assert.equal(
    approvalsDir({ repoRoot, env: { ATLAS_AGENT_STATE_DIR: elsewhere } }),
    path.join(path.resolve(elsewhere), "approvals"),
  );
});

/* ── Task schema ─────────────────────────────────────────────────────────── */

test("a task file needs no approval fields, and approved:true is rejected", () => {
  const spec = { ...SPEC, baseCommit: "a".repeat(40) };
  const clean = validateTask(spec);
  assert.equal(clean.valid, true);
  assert.deepEqual(clean.warnings, []);

  const legacy = validateTask({ ...spec, approved: false, approvedAt: null, approvedBy: null });
  assert.equal(legacy.valid, true, "legacy drafts still validate");
  assert.equal(legacy.warnings.length, 3, "but every deprecated field is flagged");

  const claiming = validateTask({ ...spec, approved: true });
  assert.equal(claiming.valid, false, "a file claiming approval must not validate");
  assert.ok(claiming.errors.some((e) => e.includes("agent:approve")));
});

/* ── The approve command ─────────────────────────────────────────────────── */

test("approving writes a receipt outside the repo and leaves it untouched", () => {
  const box = sandbox();
  const before = box.git("status", "--short");
  const head = box.git("rev-parse", "HEAD");
  const commitsBefore = box.git("rev-list", "--count", "HEAD");
  const branchesBefore = box.git("branch", "--list").split("\n").filter(Boolean).length;

  const result = box.approve();

  assert.equal(result.ok, true);
  assert.equal(result.status, "APPROVED");
  const receipt = JSON.parse(readFileSync(result.receiptFile, "utf8"));
  assert.equal(receipt.approvalVersion, APPROVAL_VERSION);
  assert.equal(receipt.taskId, "TEST-APPROVAL");
  assert.equal(receipt.approvedBy, "Sai Sai Khay");
  assert.equal(receipt.baseCommit, box.baseCommit);
  assert.equal(receipt.taskHash, hashTask(box.task));
  assert.ok(!Number.isNaN(new Date(receipt.approvedAt).getTime()));

  // The receipt is outside the repository, and the repository is unchanged.
  assert.ok(!path.resolve(result.receiptFile).startsWith(path.resolve(box.repo) + path.sep));
  assert.equal(box.git("status", "--short"), before, "repository must stay clean");
  assert.equal(box.git("rev-parse", "HEAD"), head, "HEAD must not move");
  assert.equal(box.git("rev-list", "--count", "HEAD"), commitsBefore, "no commit was created");
  assert.equal(box.git("worktree", "list").split("\n").length, 1, "no worktree was created");
  assert.equal(
    box.git("branch", "--list").split("\n").filter(Boolean).length,
    branchesBefore,
    "no branch was created",
  );

  // No secret material in the receipt.
  const text = readFileSync(result.receiptFile, "utf8");
  for (const word of ["secret", "token", "password", "apiKey", "credential"]) {
    assert.ok(!text.toLowerCase().includes(word.toLowerCase()), `receipt must not mention ${word}`);
  }
});

test("approval refuses a dirty repository but tolerates untracked run reports", () => {
  const dirtyBox = sandbox({ dirty: true });
  const dirty = dirtyBox.approve();
  assert.equal(dirty.ok, false);
  assert.equal(dirty.status, "DIRTY_REPOSITORY");
  assert.ok(!existsSync(receiptPath("TEST-APPROVAL", dirtyBox.state)));

  // A dry-run report sitting in project/runs/ is a documented exemption.
  const okBox = sandbox({ extraUntracked: "project/runs/run-x.json" });
  assert.equal(okBox.approve().ok, true);

  assert.deepEqual(blockingDirt("?? project/runs/run-x.json\n"), []);
  assert.deepEqual(blockingDirt(" M src/a.ts\n"), [" M src/a.ts"]);
  assert.deepEqual(blockingDirt("?? src/new.ts\n"), ["?? src/new.ts"]);
});

test("committing the task file does not invalidate the base it names", () => {
  // This is the whole point of the project-only ancestor rule: the sandbox
  // already committed the task under project/ AFTER its baseCommit, so HEAD is
  // one commit ahead. Approval must still work, or the documented flow
  // (prepare → commit → approve) would be impossible.
  const box = sandbox();
  assert.notEqual(box.git("rev-parse", "HEAD"), box.baseCommit, "HEAD is ahead of the base");
  assert.equal(box.approve().ok, true);
  assert.equal(box.preflight().status, "READY_TO_RUN");
});

/* ── Control-plane drift vs. product drift ───────────────────────────────── */
//
// TWO DIFFERENT BASES. `task.baseCommit` is the APPROVED PRODUCT BASE — the code
// a human read, and the commit the task worktree branches from. The agent
// RUNTIME is separate, and fixing a bug in it must not invalidate work already
// approved and in flight. Anything else that moves is product drift and still
// fails closed.

test("the safe control-plane set is explicit, minimal and testable", () => {
  // project/PERMISSIONS.md `project_rule_update`: AGENTS.md, project/*.md, agent/**.
  for (const safe of [
    "agent/engine.mjs",
    "agent/adapters/claude.mjs",
    "agent/adapters/codex.mjs",
    "agent/engine.test.mjs",
    "project/DECISIONS.md",
    "project/tasks/ATLAS-005.json",
    "AGENTS.md",
  ]) {
    assert.equal(isControlPlanePath(safe), true, `${safe} is control plane`);
  }

  // Everything else is product, including docs and near-misses on the prefixes.
  for (const product of [
    "src/components/staff/OrderDetailDrawer.tsx",
    "api/_lib/staffOrderWrites.server.ts",
    "docs/sql/2026-08-19-staff-verified-transfer.sql",
    "docs/AGENTS.md",
    "scripts/test-status-transitions.mjs",
    "package.json",
    "vercel.json",
    "README.md",
    "agentic/thing.mjs",
    "project.json",
    "project",
  ]) {
    assert.equal(isControlPlanePath(product), false, `${product} is NOT control plane`);
  }
});

test("safe control-plane drift resumes on the new runtime and never touches the worktree", () => {
  const box = sandbox();
  assert.equal(box.approve().ok, true);
  const approvedProductBase = box.task.baseCommit;

  // 1 + 3. The preserved task worktree, exactly as a real run leaves it:
  // branched from the approved product base, with the Builder's product diff
  // sitting in it uncommitted.
  const plan = planWorkspace(box.task, box.repo);
  createWorkspace({ ...plan, baseCommit: approvedProductBase, cwd: box.repo });
  const inWorktree = (...args) =>
    execFileSync("git", args, { cwd: plan.worktree, encoding: "utf8" }).trim();
  const product = path.join(plan.worktree, "src", "builder-work.ts");
  writeFileSync(product, "export const work = 1;\n");
  const worktreeHead = inWorktree("rev-parse", "HEAD");
  assert.equal(worktreeHead, approvedProductBase);

  // 2. main advances with ONLY agent control-plane files — the real ATLAS-005
  // situation: an adapter bug found and fixed while the task was in flight.
  const runtimeHead = box.commit(
    {
      "agent/adapters/claude.mjs": "// fixed adapter\n",
      "agent/adapters/codex.mjs": "// fixed adapter\n",
      "agent/engine.test.mjs": "// covering test\n",
    },
    "fix(agent): trust successful adapter results before auth heuristics",
  );
  assert.notEqual(runtimeHead, approvedProductBase);

  // 4. Resume is allowed, on the newer runtime.
  const result = box.preflight({ expectWorktree: true });
  assert.equal(result.status, "READY_TO_RUN");

  // 5. The product base did not move — not in the result, not in the task file.
  assert.equal(result.approvedProductBase, approvedProductBase);
  assert.equal(result.runtimeHead, runtimeHead);
  assert.equal(JSON.parse(readFileSync(box.taskFile, "utf8")).baseCommit, approvedProductBase);

  // 7. The acceptance is recorded, with the files that justified it.
  assert.equal(result.controlPlaneDrift.accepted, true);
  assert.deepEqual(result.controlPlaneDrift.files, [
    "agent/adapters/claude.mjs",
    "agent/adapters/codex.mjs",
    "agent/engine.test.mjs",
    // The task specification commit itself — the original D-017 case, which is
    // the same rule: agent memory is control plane, not product.
    "project/tasks/TEST-APPROVAL.json",
  ]);
  assert.equal(result.gates.find((g) => g.name === "base_commit").ok, true);

  // 6. The receipt still binds the approved specification and its product base.
  const approval = verifyApproval({ task: box.task, dir: box.state });
  assert.equal(approval.status, "APPROVED");
  assert.equal(approval.receipt.baseCommit, approvedProductBase);

  // 3 + 7. Nothing was rebased, reset, stashed, recreated or deleted.
  assert.equal(inWorktree("rev-parse", "HEAD"), worktreeHead, "the worktree did not move");
  assert.equal(worktreeState(plan.worktree, box.repo), "registered");
  assert.equal(readFileSync(product, "utf8"), "export const work = 1;\n");
  assert.match(inWorktree("status", "--short"), /builder-work\.ts/, "the diff is still there");
});

test("product drift past the approved base still fails closed", () => {
  const cases = [
    ["a src/ change", { "src/later.ts": "export const later = 1;\n" }],
    ["an api/ change", { "api/_lib/staffOrderWrites.server.ts": "export const w = 1;\n" }],
    ["a docs/sql/ change", { "docs/sql/2026-08-19-staff-verified-transfer.sql": "select 1;\n" }],
    [
      "agent and product mixed together",
      { "agent/engine.mjs": "// tweak\n", "src/later.ts": "export const later = 1;\n" },
    ],
    ["an arbitrary unrelated file", { "README.md": "# hello\n" }],
    ["an arbitrary doc", { "docs/notes.md": "notes\n" }],
  ];

  for (const [name, files] of cases) {
    const box = sandbox();
    assert.equal(box.approve().ok, true);
    box.commit(files, `drift: ${name}`);

    const result = box.preflight();
    assert.equal(result.status, "BASE_COMMIT_MISMATCH", name);
    assert.equal(result.controlPlaneDrift, null, `${name}: nothing was accepted`);
    const gate = result.gates.find((g) => g.name === "base_commit");
    assert.equal(gate.ok, false, name);
    assert.match(gate.detail, /product changes/, name);

    // And a human cannot approve their way around it either.
    const reapproved = box.approve();
    assert.equal(reapproved.ok, false, name);
    assert.equal(reapproved.status, "BASE_COMMIT_MISMATCH", name);
  }
});

test("approval refuses when HEAD is not the task's base commit", () => {
  const box = sandbox();
  writeFileSync(path.join(box.repo, "src", "later.ts"), "export const later = 1;\n");
  box.git("add", "-A");
  box.git("commit", "--quiet", "-m", "moved on");

  const result = box.approve();
  assert.equal(result.ok, false);
  assert.equal(result.status, "BASE_COMMIT_MISMATCH");
  assert.ok(!existsSync(receiptPath("TEST-APPROVAL", box.state)));
});

test("approval requires a named human", () => {
  const box = sandbox();
  for (const by of [undefined, "", "   "]) {
    const result = box.approve({ approvedBy: by });
    assert.equal(result.ok, false);
    assert.equal(result.status, "APPROVER_MISSING");
  }
  assert.ok(!existsSync(receiptPath("TEST-APPROVAL", box.state)));
});

test("approval refuses a task requesting a protected operation", () => {
  const box = sandbox({ task: { permissions: ["read_repository", "production_deploy"] } });
  const result = box.approve();
  assert.equal(result.ok, false);
  assert.equal(result.status, "BLOCKED_PERMISSION");
  assert.ok(!existsSync(receiptPath("TEST-APPROVAL", box.state)));
});

test("approval refuses an invalid task", () => {
  const box = sandbox({ task: { riskLevel: "wat" } });
  const result = box.approve();
  assert.equal(result.ok, false);
  assert.equal(result.status, "INVALID_TASK");
});

/* ── Verification ────────────────────────────────────────────────────────── */

test("a valid receipt verifies", () => {
  const box = sandbox();
  box.approve();
  const result = verifyApproval({ task: box.task, dir: box.state });
  assert.equal(result.status, "APPROVED");
  assert.equal(result.receipt.approvedBy, "Sai Sai Khay");
});

test("a missing receipt is APPROVAL_MISSING", () => {
  const box = sandbox();
  const result = verifyApproval({ task: box.task, dir: box.state });
  assert.equal(result.status, "APPROVAL_MISSING");
  assert.match(result.detail, /agent:approve/);
});

test("a malformed receipt is APPROVAL_INVALID", () => {
  const box = sandbox();
  mkdirSync(box.state, { recursive: true });
  const file = receiptPath("TEST-APPROVAL", box.state);

  writeFileSync(file, "{ not json");
  assert.equal(verifyApproval({ task: box.task, dir: box.state }).status, "APPROVAL_INVALID");

  writeFileSync(file, JSON.stringify(["an", "array"]));
  assert.equal(verifyApproval({ task: box.task, dir: box.state }).status, "APPROVAL_INVALID");

  const good = buildReceipt({ task: box.task, taskFile: box.taskFile, approvedBy: "X" });
  for (const field of ["taskId", "taskHash", "baseCommit", "approvedBy", "approvedAt"]) {
    writeFileSync(file, JSON.stringify({ ...good, [field]: "" }));
    const result = verifyApproval({ task: box.task, dir: box.state });
    assert.equal(result.status, "APPROVAL_INVALID", `empty ${field} must be rejected`);
  }

  writeFileSync(file, JSON.stringify({ ...good, approvalVersion: 99 }));
  assert.equal(verifyApproval({ task: box.task, dir: box.state }).status, "APPROVAL_INVALID");
});

test("a receipt for another task id is APPROVAL_INVALID", () => {
  const box = sandbox();
  mkdirSync(box.state, { recursive: true });
  const receipt = buildReceipt({ task: box.task, taskFile: box.taskFile, approvedBy: "X" });
  writeFileSync(
    receiptPath("TEST-APPROVAL", box.state),
    JSON.stringify({ ...receipt, taskId: "SOMETHING-ELSE" }),
  );
  const result = verifyApproval({ task: box.task, dir: box.state });
  assert.equal(result.status, "APPROVAL_INVALID");
  assert.match(result.detail, /SOMETHING-ELSE/);
});

test("an invalid or future timestamp is APPROVAL_INVALID", () => {
  const box = sandbox();
  mkdirSync(box.state, { recursive: true });
  const file = receiptPath("TEST-APPROVAL", box.state);
  const receipt = buildReceipt({ task: box.task, taskFile: box.taskFile, approvedBy: "X" });

  writeFileSync(file, JSON.stringify({ ...receipt, approvedAt: "not-a-date" }));
  assert.equal(verifyApproval({ task: box.task, dir: box.state }).status, "APPROVAL_INVALID");

  const future = new Date(Date.now() + 86_400_000).toISOString();
  writeFileSync(file, JSON.stringify({ ...receipt, approvedAt: future }));
  const result = verifyApproval({ task: box.task, dir: box.state });
  assert.equal(result.status, "APPROVAL_INVALID");
  assert.match(result.detail, /future/);
});

test("editing the task after approval makes the receipt APPROVAL_STALE", () => {
  const box = sandbox();
  assert.equal(box.approve().ok, true);
  assert.equal(verifyApproval({ task: box.task, dir: box.state }).status, "APPROVED");

  // The human widens the scope after approving. Consent does not carry over.
  box.edit({ allowedPaths: ["src/", "api/"] });
  const edited = JSON.parse(readFileSync(box.taskFile, "utf8"));
  const result = verifyApproval({ task: edited, dir: box.state });
  assert.equal(result.status, "APPROVAL_STALE");
  assert.match(result.detail, /task changed after approval/);
});

test("a receipt approved against a different base commit is APPROVAL_STALE", () => {
  const box = sandbox();
  mkdirSync(box.state, { recursive: true });
  const receipt = buildReceipt({ task: box.task, taskFile: box.taskFile, approvedBy: "X" });
  writeReceipt({ ...receipt, baseCommit: "b".repeat(40) }, box.state);
  const result = verifyApproval({ task: box.task, dir: box.state });
  assert.equal(result.status, "APPROVAL_STALE");
  assert.match(result.detail, /approved against base/);
});

test("removing a leftover deprecated field does not invalidate a receipt", () => {
  const box = sandbox({ task: { approved: false, approvedAt: null, approvedBy: null } });
  assert.equal(box.approve().ok, true);
  box.edit({ approved: undefined });
  const cleaned = JSON.parse(readFileSync(box.taskFile, "utf8"));
  delete cleaned.approvedAt;
  delete cleaned.approvedBy;
  assert.equal(verifyApproval({ task: cleaned, dir: box.state }).status, "APPROVED");
});

/* ── Preflight and engine integration ────────────────────────────────────── */

test("preflight refuses every bad approval state", () => {
  const missing = sandbox();
  assert.equal(missing.preflight().status, "APPROVAL_MISSING");

  const invalid = sandbox();
  mkdirSync(invalid.state, { recursive: true });
  writeFileSync(receiptPath("TEST-APPROVAL", invalid.state), "{ broken");
  assert.equal(invalid.preflight().status, "APPROVAL_INVALID");

  const stale = sandbox();
  stale.approve();
  stale.edit({ objective: "a different objective entirely" });
  assert.equal(stale.preflight().status, "APPROVAL_STALE");

  const good = sandbox();
  good.approve();
  assert.equal(good.preflight().status, "READY_TO_RUN");
});

test("agent:run refuses an unapproved task before invoking any model", async () => {
  const box = sandbox();
  let builderCalls = 0;
  let reviewerCalls = 0;
  const builder = {
    name: "must-not-run",
    build: async () => {
      builderCalls += 1;
      throw new Error("the Builder must never be invoked without approval");
    },
  };
  const reviewer = {
    name: "must-not-run",
    review: async () => {
      reviewerCalls += 1;
      throw new Error("the Reviewer must never be invoked without approval");
    },
  };

  const { run } = await runTask(box.taskFile, {
    repoRoot: box.repo,
    runsRoot: path.join(box.dir, "runs"),
    stateDir: box.state,
    git: liveGitAt(box.repo),
    builder,
    reviewer,
    autoResume: false,
  });

  assert.equal(run.state, "APPROVAL_MISSING");
  assert.equal(builderCalls, 0);
  assert.equal(reviewerCalls, 0);
  assert.equal(run.worktree, null, "no worktree may be created");
  assert.equal(box.git("status", "--short"), "", "the repository must stay clean");
  assert.equal(box.git("branch", "--list").split("\n").filter(Boolean).length, 1);
});

test("agent:run refuses a stale approval before invoking any model", async () => {
  const box = sandbox();
  box.approve();
  box.edit({ allowedPaths: ["src/", "scripts/"] });

  let calls = 0;
  const builder = {
    name: "must-not-run",
    build: async () => {
      calls += 1;
      return { outcome: "success", report: { summary: "x", filesChanged: [] } };
    },
  };

  const { run } = await runTask(box.taskFile, {
    repoRoot: box.repo,
    runsRoot: path.join(box.dir, "runs"),
    stateDir: box.state,
    git: liveGitAt(box.repo),
    builder,
    autoResume: false,
  });

  assert.equal(run.state, "APPROVAL_STALE");
  assert.equal(calls, 0);
});

/* ── Cleanup ─────────────────────────────────────────────────────────────── */

test("temp state directories are removable and hold only receipts", () => {
  const box = sandbox();
  box.approve();
  assert.ok(existsSync(box.state));
  assert.deepEqual(
    readFileSync(receiptPath("TEST-APPROVAL", box.state), "utf8").trim().slice(0, 1),
    "{",
  );
  rmSync(box.dir, { recursive: true, force: true });
  assert.equal(existsSync(box.state), false);
  assert.equal(existsSync(box.repo), false);
});
