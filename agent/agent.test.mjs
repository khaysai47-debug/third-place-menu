// Coordinator safety tests. Run with `npm run agent:test`.
//
// Node's built-in test runner, no dependencies. Every test drives the gates
// through a FAKE git reader, so the suite is deterministic regardless of the
// real repository's HEAD or cleanliness, and creates no branch, worktree,
// commit, push or deployment. Task files and reports go to a temp directory
// that is removed afterwards.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { classifyLintResults, hasNewFailure } from "./checks.mjs";
import { dryRun, executionPreflight, OK_STATUSES, validate } from "./coordinator.mjs";
import {
  CHECK_RESULTS,
  PAUSE_STATES,
  RUN_STATES,
  validateCheckpoint,
  validateTask,
} from "./schemas.mjs";

const BASE = "1c1e8908dc14ce49f0f188d66870447eb0b40a9c";
const OTHER = "0000000000000000000000000000000000000000";

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "atlas-agent-test-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const runsDir = () => path.join(dir, "runs");

/** A structurally valid, unapproved, low-risk task. */
const baseTask = (overrides = {}) => ({
  taskId: "TEST-001",
  title: "Test task",
  objective: "Exercise the coordinator gates.",
  context: "Fixture only.",
  owner: "test",
  riskLevel: "low",
  baseCommit: BASE,
  allowedPaths: ["src/"],
  forbiddenPaths: ["api/"],
  acceptanceCriteria: ["Nothing real happens."],
  requiredChecks: ["typecheck", "lint", "build"],
  permissions: ["read_repository", "run_checks"],
  stoppingRules: ["Stop on anything unexpected."],
  approved: false,
  approvedAt: null,
  approvedBy: null,
  ...overrides,
});

const approved = (overrides = {}) =>
  baseTask({
    approved: true,
    approvedAt: "2026-08-05T00:00:00Z",
    approvedBy: "test",
    ...overrides,
  });

const writeTask = (name, task) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(task));
  return file;
};

/** Fake repository readers — no git process, no repository mutation. */
const fakeGit = ({ head = BASE, status = "", worktree = "absent" } = {}) => ({
  headCommit: () => head,
  statusShort: () => status,
  worktreeState: () => worktree,
});

const statusOf = (name, task, gitOptions) =>
  dryRun(writeTask(name, task), { git: fakeGit(gitOptions), runsDir: runsDir() }).report
    .finalStatus;

test("structurally invalid task is rejected", () => {
  const file = writeTask("invalid", baseTask({ riskLevel: "wat", permissions: ["nope"] }));
  const result = validate(file);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("riskLevel")));
  assert.ok(result.errors.some((e) => e.includes("nope")));
  assert.equal(statusOf("invalid2", baseTask({ riskLevel: "wat" })), "INVALID_TASK");
});

test("unapproved valid task stops at READY_FOR_APPROVAL", () => {
  assert.equal(validateTask(baseTask()).valid, true);
  // Dirty tree and drifted HEAD must not mask the real blocker: no approval.
  assert.equal(
    statusOf("draft", baseTask(), { head: OTHER, status: " M x.ts" }),
    "READY_FOR_APPROVAL",
  );
});

test("protected action request is blocked", () => {
  const task = approved({ permissions: ["read_repository", "production_deploy"] });
  assert.equal(statusOf("protected", task), "BLOCKED_PERMISSION");
  const preflight = executionPreflight(writeTask("protected2", task), { git: fakeGit() });
  assert.equal(preflight.status, "BLOCKED_PERMISSION");
  assert.deepEqual(preflight.protectedActions, ["production_deploy"]);
});

test("wrong base commit is blocked", () => {
  assert.equal(statusOf("mismatch", approved(), { head: OTHER }), "BASE_COMMIT_MISMATCH");
});

test("dirty repository is blocked for an approved task", () => {
  assert.equal(statusOf("dirty", approved(), { status: " M src/a.ts" }), "DIRTY_REPOSITORY");
});

test("foreign worktree path is blocked", () => {
  assert.equal(statusOf("foreign", approved(), { worktree: "foreign" }), "WORKTREE_CONFLICT");
});

test("valid approved low-risk task reaches READY_TO_RUN", () => {
  const file = writeTask("ready", approved());
  const { report } = dryRun(file, { git: fakeGit(), runsDir: runsDir() });
  assert.equal(report.finalStatus, "READY_TO_RUN");
  assert.equal(report.proposedBranch, "agent/TEST-001-test-task");
  // A dry run never authorizes execution, even when every gate passes.
  assert.equal(report.authorizes, false);
});

test("execution preflight re-reads the task from disk", () => {
  const file = writeTask("revalidate", approved());
  assert.equal(executionPreflight(file, { git: fakeGit() }).status, "READY_TO_RUN");
  // Approval revoked on disk after a clean preflight: the next call must fail.
  writeFileSync(file, JSON.stringify(baseTask()));
  assert.equal(executionPreflight(file, { git: fakeGit() }).status, "READY_FOR_APPROVAL");
});

test("every gate is recorded in order and stops at the first failure", () => {
  const { gates, status } = executionPreflight(writeTask("gates", approved()), {
    git: fakeGit({ status: " M src/a.ts" }),
  });
  assert.equal(status, "DIRTY_REPOSITORY");
  assert.deepEqual(
    gates.map((g) => g.name),
    ["task_valid", "no_protected_actions", "approved", "base_commit", "clean_tree"],
  );
  assert.equal(gates.at(-1).ok, false);
});

test("status to exit-code mapping", () => {
  const exitCode = (status) => (OK_STATUSES.includes(status) ? 0 : 1);
  assert.equal(exitCode("READY_TO_RUN"), 0);
  assert.equal(exitCode("READY_FOR_APPROVAL"), 0);
  for (const status of [
    "BLOCKED_PERMISSION",
    "INVALID_TASK",
    "BASE_COMMIT_MISMATCH",
    "DIRTY_REPOSITORY",
    "WORKTREE_CONFLICT",
    "FAILED",
  ]) {
    assert.equal(exitCode(status), 1, `${status} must exit non-zero`);
  }
});

test("CLI exits 0 on the real unapproved sample task", () => {
  const out = execFileSync(
    process.execPath,
    ["agent/cli.mjs", "dry-run", "--task", "project/tasks/ATLAS-001.json", "--runs-dir", runsDir()],
    { encoding: "utf8" },
  );
  assert.match(out, /status {4}READY_FOR_APPROVAL/);
});

test("check result model and run states are complete", () => {
  assert.deepEqual(CHECK_RESULTS, ["PASS", "NEW_FAILURE", "BASELINE_FAILURE"]);
  assert.deepEqual(PAUSE_STATES, [
    "PAUSED_USAGE_LIMIT",
    "PAUSED_AUTH_REQUIRED",
    "PAUSED_NETWORK_ERROR",
    "RESUME_SCHEDULED",
    "RESUMING",
  ]);
  for (const state of PAUSE_STATES) assert.ok(RUN_STATES.includes(state));
  assert.equal(hasNewFailure([{ result: "BASELINE_FAILURE" }, { result: "PASS" }]), false);
  assert.equal(hasNewFailure([{ result: "BASELINE_FAILURE" }, { result: "NEW_FAILURE" }]), true);
});

test("lint classification is by ownership, with CRLF debt broken out", () => {
  const err = (rule, message) => ({ ruleId: rule, severity: 2, line: 1, message });
  const results = [
    {
      filePath: "D:\\Projects\\third-place-menu\\src\\old.ts",
      messages: [err("prettier/prettier", "Delete `␍`")],
    },
    {
      filePath: "D:\\Projects\\third-place-menu\\src\\other.ts",
      messages: [err("no-control-regex", "bad regex")],
    },
    {
      filePath: "D:\\Projects\\third-place-menu\\src\\warn.ts",
      messages: [{ severity: 1, ruleId: "x" }],
    },
  ];

  // Nothing owned: every error is pre-existing debt, CRLF counted separately.
  const untouched = classifyLintResults(results, new Set());
  assert.equal(untouched.result, "BASELINE_FAILURE");
  assert.equal(untouched.newFailures.length, 0);
  assert.equal(untouched.baselineFailures.length, 2);
  assert.deepEqual(untouched.baselineBreakdown, { crlf: 1, other: 1 });

  // A CR in a file the run changed is the run's fault, not baseline.
  const owned = classifyLintResults(results, new Set(["src/old.ts"]));
  assert.equal(owned.result, "NEW_FAILURE");
  assert.equal(owned.newFailures.length, 1);
  assert.equal(owned.baselineBreakdown.crlf, 0);

  // Warnings are never failures.
  assert.equal(classifyLintResults([results[2]], new Set(["src/warn.ts"])).result, "PASS");
});

test("checkpoint schema validation", () => {
  const checkpoint = {
    runId: "run-x",
    taskId: "TEST-001",
    stage: "implementation",
    builderSessionId: null,
    worktreePath: "/tmp/wt",
    baseCommit: BASE,
    currentCommit: BASE,
    implementationRound: 1,
    revisionRound: 0,
    filesChanged: [],
    lastSuccessfulStage: "planning",
    pauseReason: "usage_limit",
    expectedRetryAt: "2026-08-05T09:00:00Z",
    retryCount: 1,
    updatedAt: "2026-08-05T08:00:00Z",
  };
  assert.equal(validateCheckpoint(checkpoint).valid, true);

  const { revisionRound, ...missing } = checkpoint;
  void revisionRound;
  assert.ok(validateCheckpoint(missing).errors.some((e) => e.includes("revisionRound")));
  assert.equal(validateCheckpoint({ ...checkpoint, stage: "nonsense" }).valid, false);
  assert.equal(validateCheckpoint({ ...checkpoint, pauseReason: "bored" }).valid, false);
  assert.equal(validateCheckpoint({ ...checkpoint, pauseReason: null }).valid, true);
});

test("no report leaked into project/runs and temp state is removable", () => {
  const produced = readdirSync(runsDir());
  assert.ok(produced.length > 0, "tests should have written reports to the temp runs dir");
  assert.ok(
    !readdirSync(path.join("project", "runs")).some((f) => f.includes("TEST-001")),
    "no test report may be written into project/runs",
  );
  rmSync(runsDir(), { recursive: true, force: true });
  assert.equal(existsSync(runsDir()), false);
});
