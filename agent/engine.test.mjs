// Execution-engine tests. Run with `npm run agent:test:engine`.
//
// Every test builds a REAL temporary git repository and drives the engine with
// FAKE Builder and Reviewer adapters. Nothing here invokes Claude or Codex,
// touches the network, consumes quota, or writes to the Atlas repository.
// Branches, worktrees and temp directories are removed in after().
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  assertSafeCommand as assertBuilderSafe,
  buildCommand as buildClaudeCommand,
  classifyResult,
  parseBuilderReport,
  parseResetAt,
} from "./adapters/claude.mjs";
import {
  assertSafeCommand as assertReviewerSafe,
  buildCommand as buildCodexCommand,
  parseReview,
} from "./adapters/codex.mjs";
import { buildReceipt, writeReceipt } from "./approval.mjs";
import { liveGitAt } from "./coordinator.mjs";
import { resumeRun, runTask } from "./engine.mjs";
import { RunStore } from "./runstore.mjs";
import { checkScope } from "./scope.mjs";
import { removeWorkspace } from "./workspace.mjs";

const BASE_TASK = {
  taskId: "TEST-ENGINE",
  title: "Engine fixture",
  objective: "Exercise the execution loop.",
  context: "Fixture only. No real work.",
  owner: "test",
  riskLevel: "low",
  allowedPaths: ["src/"],
  forbiddenPaths: ["api/"],
  acceptanceCriteria: ["Nothing real happens."],
  requiredChecks: ["typecheck"],
  permissions: ["read_repository", "run_checks"],
  stoppingRules: ["Stop on anything unexpected."],
};

/* ── Temporary repository ────────────────────────────────────────────────── */

const sandboxes = [];

afterEach(() => {
  while (sandboxes.length) {
    const sandbox = sandboxes.pop();
    try {
      for (const branch of sandbox.branches) {
        removeWorkspace({ branch, worktree: sandbox.worktreeFor(branch), cwd: sandbox.repo });
      }
    } catch {
      /* best effort */
    }
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

function sandbox({ task = {}, dirty = false, approve = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-engine-"));
  const repo = path.join(dir, "repo");
  mkdirSync(path.join(repo, "src"), { recursive: true });
  mkdirSync(path.join(repo, "api"), { recursive: true });

  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Engine Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "src", "seed.ts"), "export const seed = 1;\n");
  writeFileSync(path.join(repo, "api", "seed.ts"), "export const api = 1;\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "seed");
  const baseCommit = git("rev-parse", "HEAD");

  if (dirty) writeFileSync(path.join(repo, "src", "seed.ts"), "export const seed = 2;\n");

  const taskFile = path.join(dir, "task.json");
  const full = { ...BASE_TASK, baseCommit, ...task };
  writeFileSync(taskFile, JSON.stringify(full));

  // Approval is an EXTERNAL receipt, written outside the temp repository.
  const state = path.join(dir, "state", "approvals");
  if (approve) {
    writeReceipt(buildReceipt({ task: full, taskFile, approvedBy: "test" }), state);
  }

  const box = {
    dir,
    repo,
    taskFile,
    task: full,
    baseCommit,
    runsRoot: path.join(dir, "runs"),
    state,
    branches: [`agent/${full.taskId}-${full.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`],
    worktreeFor: () => path.join(dir, `${path.basename(repo)}-agent-worktrees`, full.taskId),
    git,
  };
  sandboxes.push(box);
  return box;
}

const engineOpts = (box, extra = {}) => ({
  repoRoot: box.repo,
  runsRoot: box.runsRoot,
  stateDir: box.state,
  git: liveGitAt(box.repo),
  autoResume: false,
  sleep: async () => {},
  ...extra,
});

/* ── Fake adapters ───────────────────────────────────────────────────────── */

/** A Builder that writes the files it is told to, then reports success. */
const fakeBuilder = (script) => {
  let call = 0;
  return {
    name: "fake-builder",
    build: async ({ worktree, sessionId }) => {
      const step = script[Math.min(call, script.length - 1)];
      call += 1;
      if (step.outcome && step.outcome !== "success") {
        return { ...step, stdout: "", stderr: step.detail ?? "" };
      }
      for (const [file, content] of Object.entries(step.files ?? {})) {
        const target = path.join(worktree, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
      return {
        outcome: "success",
        detail: "ok",
        sessionId: step.sessionId ?? sessionId ?? "session-fake-1",
        report: {
          summary: step.summary ?? "did the thing",
          filesChanged: Object.keys(step.files ?? {}),
          notes: [],
        },
        stdout: "{}",
        stderr: "",
        calls: call,
      };
    },
    get calls() {
      return call;
    },
  };
};

/** A Reviewer that returns scripted verdicts. */
const fakeReviewer = (script) => {
  let call = 0;
  return {
    name: "fake-reviewer",
    review: async () => {
      const step = script[Math.min(call, script.length - 1)];
      call += 1;
      if (step.outcome && step.outcome !== "success") return { ...step, lastMessage: "" };
      return { outcome: "success", review: step.review, lastMessage: JSON.stringify(step.review) };
    },
    get calls() {
      return call;
    },
  };
};

const PASS_REVIEW = { verdict: "PASS", summary: "looks right", findings: [] };
const REVISE_REVIEW = {
  verdict: "REVISE",
  summary: "one problem",
  findings: [
    {
      id: "F1",
      severity: "major",
      category: "correctness",
      file: "src/feature.ts",
      evidence: "returns the wrong constant",
      requiredCorrection: "return 2",
    },
  ],
};

const passingChecks = () => [
  {
    name: "typecheck",
    result: "PASS",
    exitCode: 0,
    newFailures: [],
    baselineFailures: [],
    log: "",
  },
];
const failingChecks = () => [
  {
    name: "typecheck",
    result: "NEW_FAILURE",
    exitCode: 1,
    newFailures: [{ file: "src/feature.ts", line: 1, message: "type error" }],
    baselineFailures: [],
    log: "tsc failed",
  },
];

/* ── Preflight refusals: no adapter may be invoked ───────────────────────── */

test("a task with no approval receipt is blocked before any adapter is invoked", async () => {
  const box = sandbox({ approve: false });
  const builder = fakeBuilder([{ files: {} }]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);

  const { run } = await runTask(box.taskFile, engineOpts(box, { builder, reviewer }));

  assert.equal(run.state, "APPROVAL_MISSING");
  assert.equal(builder.calls, 0, "Builder must not be invoked without an approval receipt");
  assert.equal(reviewer.calls, 0);
  assert.equal(run.worktree, null, "no worktree may be created");
});

test("wrong base commit blocks execution", async () => {
  const box = sandbox({ task: { baseCommit: "0".repeat(40) } });
  const builder = fakeBuilder([{ files: {} }]);
  const { run } = await runTask(box.taskFile, engineOpts(box, { builder }));
  assert.equal(run.state, "BASE_COMMIT_MISMATCH");
  assert.equal(builder.calls, 0);
});

test("dirty main repository blocks execution", async () => {
  const box = sandbox({ dirty: true });
  const builder = fakeBuilder([{ files: {} }]);
  const { run } = await runTask(box.taskFile, engineOpts(box, { builder }));
  assert.equal(run.state, "DIRTY_REPOSITORY");
  assert.equal(builder.calls, 0);
});

test("protected permission blocks execution", async () => {
  const box = sandbox({ task: { permissions: ["read_repository", "production_deploy"] } });
  const builder = fakeBuilder([{ files: {} }]);
  const { run } = await runTask(box.taskFile, engineOpts(box, { builder }));
  assert.equal(run.state, "BLOCKED_PERMISSION");
  assert.equal(builder.calls, 0);
});

test("existing branch blocks a new run", async () => {
  const box = sandbox();
  box.git("branch", box.branches[0]);
  const builder = fakeBuilder([{ files: {} }]);
  const { run } = await runTask(box.taskFile, engineOpts(box, { builder }));
  assert.equal(run.state, "BRANCH_EXISTS");
  assert.equal(builder.calls, 0);
});

/* ── The happy path ──────────────────────────────────────────────────────── */

test("approved safe task reaches READY_FOR_HUMAN_REVIEW", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ files: { "src/feature.ts": "export const feature = 1;\n" } }]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);

  const { run, store } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );

  assert.equal(run.state, "READY_FOR_HUMAN_REVIEW");
  assert.equal(run.reviewVerdict, "PASS");
  assert.deepEqual(run.filesChanged, ["src/feature.ts"]);
  assert.equal(run.revisionRound, 0);

  // Durable record
  for (const file of [
    "run.json",
    "checkpoint.json",
    "task-snapshot.json",
    "diff.patch",
    "final-report.md",
  ]) {
    assert.ok(existsSync(store.file(file)), `${file} must exist`);
  }
  assert.match(readFileSync(store.file("diff.patch"), "utf8"), /feature/);
  assert.match(readFileSync(store.file("final-report.md"), "utf8"), /READY_FOR_HUMAN_REVIEW/);

  // The main checkout is untouched: no commit, and still clean.
  assert.equal(box.git("status", "--short"), "");
  assert.equal(box.git("rev-parse", "HEAD"), box.baseCommit);
  assert.equal(box.git("rev-list", "--count", "HEAD"), "1");
});

test("review PASS with no file changes ends as PASS, not READY_FOR_HUMAN_REVIEW", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ files: {}, summary: "nothing needed changing" }]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);
  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );
  assert.equal(run.state, "PASS");
  assert.equal(run.filesChanged.length, 0);
});

/* ── Scope enforcement ───────────────────────────────────────────────────── */

test("Builder writing a forbidden file is blocked as SCOPE_VIOLATION", async () => {
  const box = sandbox();
  const builder = fakeBuilder([
    {
      files: {
        "src/feature.ts": "export const a = 1;\n",
        "api/secret.ts": "export const b = 2;\n",
      },
    },
  ]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);

  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );

  assert.equal(run.state, "SCOPE_VIOLATION");
  assert.equal(reviewer.calls, 0, "a scope violation must not reach the Reviewer");
  assert.ok(run.notes.some((n) => n.includes("api/secret.ts")));
  assert.equal(box.git("status", "--short"), "");
});

test("scope rules match prefixes, not substrings", () => {
  const task = { allowedPaths: ["src/"], forbiddenPaths: ["api/"] };
  assert.equal(checkScope(["src/a.ts"], task).ok, true);
  assert.equal(checkScope(["srcfake/a.ts"], task).ok, false);
  assert.equal(checkScope(["api/a.ts"], task).ok, false);
  assert.equal(checkScope(["src/a.ts", "node_modules/x/index.js"], task).ok, false);
  assert.deepEqual(
    checkScope(["dist/app.js"], { allowedPaths: ["dist/"], forbiddenPaths: [] }).unexpected,
    ["dist/app.js"],
  );
});

/* ── Checks ──────────────────────────────────────────────────────────────── */

test("check NEW_FAILURE triggers a revision, then passes", async () => {
  const box = sandbox();
  const builder = fakeBuilder([
    { files: { "src/feature.ts": "broken\n" } },
    { files: { "src/feature.ts": "export const fixed = 1;\n" } },
  ]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);
  let call = 0;
  const runChecks = () => (++call === 1 ? failingChecks() : passingChecks());

  const { run } = await runTask(box.taskFile, engineOpts(box, { builder, reviewer, runChecks }));

  assert.equal(run.state, "READY_FOR_HUMAN_REVIEW");
  assert.equal(run.revisionRound, 1);
  assert.equal(builder.calls, 2);
});

test("checks that keep failing exhaust the budget and end as CHECKS_FAILED", async () => {
  const box = sandbox();
  // Distinct failures each round, so the repeated-failure guard does not fire first.
  let n = 0;
  const runChecks = () => [
    {
      name: "typecheck",
      result: "NEW_FAILURE",
      exitCode: 1,
      newFailures: [{ file: "src/feature.ts", line: ++n, message: `error ${n}` }],
      baselineFailures: [],
      log: "",
    },
  ];
  const builder = fakeBuilder([
    { files: { "src/feature.ts": "a\n" } },
    { files: { "src/feature.ts": "b\n" } },
    { files: { "src/feature.ts": "c\n" } },
  ]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);

  const { run } = await runTask(box.taskFile, engineOpts(box, { builder, reviewer, runChecks }));

  assert.equal(run.state, "CHECKS_FAILED");
  assert.equal(run.revisionRound, 2, "exactly two revision rounds");
  assert.equal(reviewer.calls, 0, "failing checks never reach the Reviewer");
});

/* ── Review loop ─────────────────────────────────────────────────────────── */

test("reviewer REVISE then PASS completes in one revision round", async () => {
  const box = sandbox();
  const builder = fakeBuilder([
    { files: { "src/feature.ts": "export const v = 1;\n" } },
    { files: { "src/feature.ts": "export const v = 2;\n" } },
  ]);
  const reviewer = fakeReviewer([{ review: REVISE_REVIEW }, { review: PASS_REVIEW }]);

  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );

  assert.equal(run.state, "READY_FOR_HUMAN_REVIEW");
  assert.equal(run.revisionRound, 1);
  assert.equal(builder.calls, 2);
  assert.equal(reviewer.calls, 2);
});

test("maximum revision rounds is enforced and ends as NEEDS_HUMAN", async () => {
  const box = sandbox();
  const builder = fakeBuilder([
    { files: { "src/feature.ts": "1\n" } },
    { files: { "src/feature.ts": "2\n" } },
    { files: { "src/feature.ts": "3\n" } },
    { files: { "src/feature.ts": "4\n" } },
  ]);
  // A different finding each time, so the repeated-failure guard does not fire.
  let n = 0;
  const reviewer = {
    name: "fake",
    calls: 0,
    review: async () => {
      reviewer.calls += 1;
      n += 1;
      return {
        outcome: "success",
        review: {
          verdict: "REVISE",
          summary: `round ${n}`,
          findings: [
            {
              id: `F${n}`,
              severity: "major",
              category: "correctness",
              file: "src/feature.ts",
              evidence: `problem ${n}`,
              requiredCorrection: `fix ${n}`,
            },
          ],
        },
        lastMessage: "",
      };
    },
  };

  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );

  assert.equal(run.state, "NEEDS_HUMAN");
  assert.equal(run.revisionRound, 2);
  assert.equal(builder.calls, 3, "initial implementation plus two revisions");
});

test("reviewer NEEDS_HUMAN stops immediately", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ files: { "src/feature.ts": "x\n" } }]);
  const reviewer = fakeReviewer([
    { review: { verdict: "NEEDS_HUMAN", summary: "ambiguous task", findings: [] } },
  ]);
  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );
  assert.equal(run.state, "NEEDS_HUMAN");
  assert.equal(run.revisionRound, 0);
});

test("repeated identical failure stops instead of retrying", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ files: { "src/feature.ts": "same\n" } }]);
  // Identical findings every round.
  const reviewer = fakeReviewer([{ review: REVISE_REVIEW }]);

  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );

  assert.equal(run.state, "NEEDS_HUMAN");
  assert.ok(run.notes.some((n) => n.includes("repeated identical failure")));
  // One revision was granted; the identical second request was refused.
  assert.equal(run.revisionRound, 1);
});

/* ── Malformed model output ──────────────────────────────────────────────── */

test("malformed Builder output fails the run", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ outcome: "malformed_output", detail: "no json block" }]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);
  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );
  assert.equal(run.state, "FAILED");
  assert.equal(reviewer.calls, 0);
  assert.ok(run.notes.some((n) => n.includes("malformed")));
});

test("malformed Reviewer output becomes NEEDS_HUMAN, never a PASS", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ files: { "src/feature.ts": "x\n" } }]);
  const reviewer = fakeReviewer([{ outcome: "malformed_output", error: "not JSON" }]);
  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );
  assert.equal(run.state, "NEEDS_HUMAN");
  assert.notEqual(run.reviewVerdict, "PASS");
});

test("reviewer schema rejects malformed verdicts rather than guessing", () => {
  assert.equal(parseReview('{"verdict":"PASS","findings":[]}').ok, true);
  assert.equal(parseReview("not json at all").ok, false);
  assert.equal(parseReview('{"verdict":"MAYBE","findings":[]}').ok, false);
  assert.equal(parseReview('{"verdict":"REVISE","findings":[]}').ok, false);
  // A finding missing requiredCorrection is not actionable.
  assert.equal(
    parseReview(
      '{"verdict":"REVISE","findings":[{"id":"F1","severity":"major","category":"x","evidence":"y"}]}',
    ).ok,
    false,
  );
  // Fenced blocks are accepted, and the last block wins.
  assert.equal(parseReview('prose\n```json\n{"verdict":"PASS","findings":[]}\n```').ok, true);
});

/* ── Pause, checkpoint and resume ────────────────────────────────────────── */

test("usage limit writes a checkpoint and does not consume a revision round", async () => {
  const box = sandbox();
  const builder = fakeBuilder([
    { outcome: "usage_limit", detail: "usage limit reached", resetAt: null },
  ]);
  const { run, store } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, autoResume: false, runChecks: passingChecks }),
  );

  assert.equal(run.state, "PAUSED_USAGE_LIMIT");
  assert.equal(run.revisionRound, 0, "a pause must not consume a revision round");
  assert.equal(run.retryCount, 1);

  const checkpoint = store.loadCheckpoint();
  assert.equal(checkpoint.pauseReason, "usage_limit");
  assert.equal(checkpoint.revisionRound, 0);
  assert.ok(checkpoint.worktreePath, "the worktree path is recorded");
  assert.ok(existsSync(checkpoint.worktreePath), "the worktree is preserved for inspection");
  assert.ok(run.notifications.some((n) => n.event === "paused"));
});

test("auth failure pauses for a human and schedules no automatic resume", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ outcome: "auth_failure", detail: "not logged in" }]);
  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, autoResume: true, maxRetries: 3 }),
  );
  assert.equal(run.state, "PAUSED_AUTH_REQUIRED");
  assert.ok(run.notes.some((n) => n.includes("needs a human")));
});

test("scheduled resume waits, revalidates and completes without spending a revision round", async () => {
  const box = sandbox();
  const waits = [];
  let call = 0;
  const builder = {
    name: "fake",
    build: async ({ worktree }) => {
      call += 1;
      if (call === 1)
        return { outcome: "usage_limit", detail: "usage limit reached", resetAt: null };
      writeFileSync(path.join(worktree, "src", "feature.ts"), "export const v = 1;\n");
      return {
        outcome: "success",
        detail: "ok",
        sessionId: "session-resumed",
        report: { summary: "done after resume", filesChanged: ["src/feature.ts"], notes: [] },
        stdout: "{}",
        stderr: "",
      };
    },
  };
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);

  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, {
      builder,
      reviewer,
      runChecks: passingChecks,
      autoResume: true,
      retryMs: 1000,
      sleep: async (ms) => waits.push(ms),
    }),
  );

  assert.equal(run.state, "READY_FOR_HUMAN_REVIEW");
  assert.equal(run.revisionRound, 0, "the pause consumed no revision round");
  assert.equal(run.retryCount, 1);
  assert.deepEqual(waits, [1000], "waited the cautious interval, once");
  assert.ok(run.notifications.some((n) => n.event === "resume_scheduled"));
  assert.ok(run.notifications.some((n) => n.event === "resumed"));
  assert.equal(run.builderSessionId, "session-resumed");
});

test("retry budget is bounded and ends as NEEDS_HUMAN", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ outcome: "usage_limit", detail: "usage limit reached" }]);
  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, {
      builder,
      autoResume: true,
      maxRetries: 2,
      retryMs: 1,
      sleep: async () => {},
    }),
  );
  assert.equal(run.state, "NEEDS_HUMAN");
  assert.equal(run.retryCount, 3, "stopped one attempt past the budget");
});

test("manual resume from a checkpoint continues the run", async () => {
  const box = sandbox();
  const paused = fakeBuilder([{ outcome: "usage_limit", detail: "usage limit reached" }]);
  const first = await runTask(
    box.taskFile,
    engineOpts(box, { builder: paused, autoResume: false }),
  );
  assert.equal(first.run.state, "PAUSED_USAGE_LIMIT");

  // A separate process would do exactly this: open the run id and continue.
  const builder = fakeBuilder([{ files: { "src/feature.ts": "export const v = 1;\n" } }]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);
  const { run } = await resumeRun(
    first.run.runId,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );

  assert.equal(run.state, "READY_FOR_HUMAN_REVIEW");
  assert.equal(run.revisionRound, 0);
  assert.ok(run.notifications.some((n) => n.event === "resumed"));
});

test("resume refuses when the repository moved under the run", async () => {
  const box = sandbox();
  const paused = fakeBuilder([{ outcome: "usage_limit", detail: "usage limit reached" }]);
  const first = await runTask(
    box.taskFile,
    engineOpts(box, { builder: paused, autoResume: false }),
  );

  // Someone commits on main while the run is paused.
  writeFileSync(path.join(box.repo, "src", "other.ts"), "export const other = 1;\n");
  box.git("add", "-A");
  box.git("commit", "--quiet", "-m", "moved on");

  const builder = fakeBuilder([{ files: { "src/feature.ts": "x\n" } }]);
  const { run } = await resumeRun(first.run.runId, engineOpts(box, { builder }));

  assert.equal(run.state, "BASE_COMMIT_MISMATCH");
  assert.equal(builder.calls, 0, "never restart blindly after the base moved");
});

test("a terminal run cannot be resumed", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ files: { "src/feature.ts": "x\n" } }]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);
  const first = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );
  assert.equal(first.run.state, "READY_FOR_HUMAN_REVIEW");

  const again = fakeBuilder([{ files: { "src/other.ts": "y\n" } }]);
  const { run } = await resumeRun(first.run.runId, engineOpts(box, { builder: again }));
  assert.equal(again.calls, 0);
  assert.ok(run.notes.some((n) => n.includes("terminal")));
});

/* ── Adapter command construction (no subprocess is spawned) ─────────────── */

test("Claude command is non-interactive and never bypasses permissions", () => {
  const { command, args } = buildClaudeCommand({ prompt: "do the thing", maxTurns: 5 });
  assert.match(command, /claude/);
  assert.ok(args.includes("--print"));
  assert.deepEqual(
    args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2),
    ["--output-format", "json"],
  );
  assert.ok(args.includes("acceptEdits"));
  assert.ok(!args.join(" ").includes("--dangerously-skip-permissions"));
  assert.ok(!args.join(" ").includes("bypassPermissions"));
  // No shell for the Builder means no git, so no commit, push or deploy.
  assert.match(args[args.indexOf("--disallowedTools") + 1], /Bash/);
  assertBuilderSafe({ args });
  assert.throws(() => assertBuilderSafe({ args: ["--dangerously-skip-permissions"] }));

  // Resuming passes the stored session so context is not lost.
  const resumed = buildClaudeCommand({ prompt: "p", sessionId: "abc123" });
  assert.deepEqual(resumed.args.slice(-2), ["--resume", "abc123"]);
});

test("Codex command is read-only and refuses write sandboxes", () => {
  const { command, args } = buildCodexCommand({
    prompt: "review",
    worktree: "/tmp/wt",
    outputFile: "/tmp/out.txt",
  });
  assert.match(command, /codex/);
  assert.ok(args.includes("exec"));
  assert.deepEqual(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2), [
    "--sandbox",
    "read-only",
  ]);
  assertReviewerSafe({ args });
  assert.throws(() => assertReviewerSafe({ args: ["exec", "--sandbox", "workspace-write"] }));
  assert.throws(() => assertReviewerSafe({ args: ["exec", "--full-auto", "read-only"] }));
});

test("Builder output classification separates pauses from failures", () => {
  const ok = JSON.stringify({
    is_error: false,
    session_id: "s1",
    num_turns: 3,
    result: 'done\n```json\n{"summary":"s","filesChanged":["src/a.ts"]}\n```',
  });
  assert.equal(classifyResult({ status: 0, stdout: ok }).outcome, "success");
  assert.equal(classifyResult({ status: 0, stdout: ok }).sessionId, "s1");

  assert.equal(
    classifyResult({ status: 1, stderr: "Claude AI usage limit reached|1754400000" }).outcome,
    "usage_limit",
  );
  assert.equal(classifyResult({ status: 1, stderr: "Invalid API key" }).outcome, "auth_failure");
  assert.equal(classifyResult({ status: 1, stderr: "fetch failed" }).outcome, "network_failure");
  assert.equal(classifyResult({ status: 0, stdout: "not json" }).outcome, "malformed_output");
  assert.equal(classifyResult({ status: 1, stdout: "{}", timedOut: true }).outcome, "timeout");
  assert.equal(
    classifyResult({ status: 1, stdout: JSON.stringify({ is_error: true, subtype: "x" }) }).outcome,
    "implementation_failure",
  );
  // A success payload without the required report block is malformed.
  assert.equal(
    classifyResult({ status: 0, stdout: JSON.stringify({ is_error: false, result: "no block" }) })
      .outcome,
    "malformed_output",
  );

  // Claude reports the reset as unix seconds; recover it as an ISO instant.
  assert.equal(
    parseResetAt("Claude AI usage limit reached|1754400000"),
    new Date(1754400000 * 1000).toISOString(),
  );
  assert.equal(parseResetAt("no reset time here"), null);
  assert.equal(parseBuilderReport('```json\n{"summary":"s","filesChanged":[]}\n```').ok, true);
  assert.equal(parseBuilderReport("nothing here").ok, false);
});

/* ── Cleanup guarantee ───────────────────────────────────────────────────── */

test("run directories are self-contained and listable", async () => {
  const box = sandbox();
  const builder = fakeBuilder([{ files: { "src/feature.ts": "x\n" } }]);
  const reviewer = fakeReviewer([{ review: PASS_REVIEW }]);
  const { run } = await runTask(
    box.taskFile,
    engineOpts(box, { builder, reviewer, runChecks: passingChecks }),
  );

  const ids = RunStore.list(box.runsRoot);
  assert.ok(ids.includes(run.runId));
  // Nothing was written into the real Atlas runs directory.
  assert.ok(!RunStore.list().includes(run.runId));
});
