#!/usr/bin/env node
// Atlas Development Agent CLI.
//
//   npm run agent:validate -- --task project/tasks/ATLAS-001.json
//   npm run agent:dry-run  -- --task project/tasks/ATLAS-001.json
//   npm run agent:approve  -- --task project/tasks/ATLAS-001.json --by "Name"
//   npm run agent:run      -- --task project/tasks/ATLAS-001.json
//   npm run agent:resume   -- --run run-20260805T101112Z-ATLAS-001
//
// Approval is an EXTERNAL receipt, written outside the repository, so approving
// does not modify, dirty or commit anything here. See agent/approval.mjs.
//
// `run` executes an APPROVED task: isolated worktree → Claude Builder → checks →
// Codex Reviewer → at most two revision rounds → report. It stops before commit,
// push, pull request, merge and deployment, always.
//
// Exit codes:
//   0  validate: task is structurally valid
//      dry-run:  READY_TO_RUN or READY_FOR_APPROVAL (a controlled, safe stop)
//      run/resume: PASS or READY_FOR_HUMAN_REVIEW
//   1  everything else — refused preflight, scope violation, failing checks,
//      NEEDS_HUMAN, a pause awaiting a human, or CLI misuse
import { actionApprovalsDir } from "./action-approval.mjs";
import { approvalsDir } from "./approval.mjs";
import { approvePendingAction } from "./approve-action.mjs";
import { approveTask } from "./approve.mjs";
import { dryRun, OK_STATUSES, validate } from "./coordinator.mjs";
import { resumeRun, runTask } from "./engine.mjs";
import { loadTaskState, orchestrate, verifyCriteria } from "./orchestrator.mjs";
import { phaseOf } from "./schemas.mjs";
import { finalReportMarkdown, statusBlock } from "./taskreport.mjs";

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const FLAGS = [
  "--task",
  "--runs-dir",
  "--run",
  "--max-retries",
  "--retry-ms",
  "--by",
  "--state-dir",
  // V2: the external state ROOT (task-state/, approvals/). --state-dir keeps
  // its old meaning — the approvals directory itself.
  "--state-root",
  "--criteria",
  "--action",
  "--action-hash",
];
const flagValues = new Set(FLAGS.map(flagValue).filter(Boolean));
const command = argv.find((arg) => !arg.startsWith("--") && !flagValues.has(arg));
const taskFile = flagValue("--task");
const runId = flagValue("--run");
// --runs-dir keeps the test suites out of project/runs; production runs omit it.
const runsDir = flagValue("--runs-dir");
// --state-dir points at the approvals directory; the default lives outside the
// repository (see approvalsDir()).
const stateDir = flagValue("--state-dir");
const approvedBy = flagValue("--by");
const stateRootFlag = flagValue("--state-root");
const noResume = argv.includes("--no-auto-resume");

const usage =
  "usage: node agent/cli.mjs <validate|dry-run|run> --task <task.json>\n" +
  '       node agent/cli.mjs approve --task <task.json> --by "Full Name"\n' +
  '       node agent/cli.mjs approve-action --task <TASK-ID> --action n8n.publish --by "Full Name"\n' +
  "       node agent/cli.mjs resume --run <run-id>\n" +
  "\n" +
  "V2 orchestration (one goal, many steps, external state):\n" +
  "       node agent/cli.mjs orchestrate --task <task.json>\n" +
  "       node agent/cli.mjs resume      --task <task.json|TASK-ID>\n" +
  "       node agent/cli.mjs status      --task <task.json|TASK-ID>\n" +
  "       node agent/cli.mjs report      --task <task.json|TASK-ID>\n" +
  '       node agent/cli.mjs verify      --task <TASK-ID> --criteria C1,C2 --by "Full Name"';

/** V2 statuses that are a controlled stop rather than a problem. */
const ORCHESTRATION_OK = ["completed", "waiting_for_approval"];

const orchestratorOpts = () => ({
  ...(runsDir ? { runsRoot: runsDir } : {}),
  ...(stateDir ? { stateDir } : {}),
  ...(stateRootFlag ? { stateRoot: stateRootFlag } : {}),
});

function printOrchestration(result) {
  if (!result.ok) {
    console.error(`error     ${result.error}`);
    return 1;
  }
  console.log(statusBlock(result.state));
  if (result.reportPath) console.log(`\nreport    ${result.reportPath}`);
  console.log(
    "\nNothing was committed, pushed, published or deployed. Every Class B/C action is queued, not performed.",
  );
  return ORCHESTRATION_OK.includes(result.state.status) ? 0 : 1;
}

const RUN_OK = ["PASS", "READY_FOR_HUMAN_REVIEW"];

function printRun(run, reportPath) {
  console.log(`run       ${run.runId}`);
  console.log(`task      ${run.taskId}`);
  console.log(`branch    ${run.branch ?? "(none)"}`);
  console.log(`worktree  ${run.worktree ?? "(none)"}`);
  console.log(`rounds    implementation ${run.implementationRound}, revision ${run.revisionRound}`);
  console.log(`files     ${run.filesChanged?.length ?? 0} changed`);
  for (const check of run.checkResults ?? []) {
    console.log(`check     ${check.name}: ${check.result}`);
  }
  console.log(`review    ${run.reviewVerdict ?? "(none)"}`);
  for (const note of run.notes ?? []) console.log(`note      ${note}`);
  for (const n of run.notifications ?? []) console.log(`notify    ${n.event}: ${n.message}`);
  console.log(`report    ${reportPath}`);
  console.log(`state     ${run.state} (${phaseOf(run.state)})`);
  if (run.worktree && RUN_OK.includes(run.state)) {
    console.log("\nNothing was committed, pushed or deployed. Review the worktree, then decide.");
  }
}

const engineOptions = () => ({
  ...(runsDir ? { runsRoot: runsDir } : {}),
  ...(stateDir ? { stateDir } : {}),
  ...(noResume ? { autoResume: false } : {}),
  ...(flagValue("--max-retries") ? { maxRetries: Number(flagValue("--max-retries")) } : {}),
  ...(flagValue("--retry-ms") ? { retryMs: Number(flagValue("--retry-ms")) } : {}),
});

if (!command) {
  console.error(usage);
  process.exit(1);
}

if (
  [
    "validate",
    "dry-run",
    "run",
    "approve",
    "approve-action",
    "orchestrate",
    "status",
    "report",
    "verify",
  ].includes(command) &&
  !taskFile
) {
  console.error(usage);
  process.exit(1);
}

if (command === "validate") {
  const result = validate(taskFile);
  for (const warning of result.warnings ?? []) console.log(`WARN    ${warning}`);
  if (result.valid) {
    console.log(`VALID   ${taskFile} (${result.task.taskId})`);
    console.log("NOTE    approval is an external receipt — run agent:approve to authorize");
    process.exit(0);
  }
  console.error(`INVALID ${taskFile}`);
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
} else if (command === "approve") {
  const result = approveTask(taskFile, { approvedBy, stateDir });
  for (const warning of result.warnings) console.log(`WARN      ${warning}`);
  if (!result.ok) {
    console.error(`status    ${result.status}`);
    console.error(`detail    ${result.detail}`);
    process.exit(1);
  }
  console.log(`task      ${result.receipt.taskId}`);
  console.log(`taskHash  ${result.taskHash}`);
  console.log(`base      ${result.receipt.baseCommit}`);
  console.log(`approvedBy ${result.receipt.approvedBy}`);
  console.log(`approvedAt ${result.receipt.approvedAt}`);
  console.log(`receipt   ${result.receiptFile}`);
  console.log(`status    APPROVED`);
  console.log(
    "\nNothing in the repository changed. Editing the task now invalidates this receipt.",
  );
  process.exit(0);
} else if (command === "approve-action") {
  const loaded = loadTaskState(taskFile, orchestratorOpts());
  if (loaded.error || !loaded.state) {
    console.error(`error     ${loaded.error ?? `no orchestration state for ${taskFile}`}`);
    process.exit(1);
  }
  const result = approvePendingAction({
    state: loaded.state,
    action: flagValue("--action"),
    actionHash: flagValue("--action-hash"),
    approvedBy,
    dir: actionApprovalsDir({ stateDir, stateRoot: stateRootFlag }),
  });
  if (!result.ok) {
    console.error(`status    ${result.status}`);
    console.error(`detail    ${result.detail}`);
    process.exit(1);
  }
  console.log(`action    ${result.pending.worker}.${result.pending.action}`);
  console.log(`hash      ${result.receipt.actionHash}`);
  console.log(`artifact  ${result.receipt.artifactHash}`);
  console.log(`approvedBy ${result.receipt.approvedBy}`);
  console.log(`receipt   ${result.receiptFile}`);
  console.log(
    "\nNo external action was performed. Resume the task to re-check the receipt at execution time.",
  );
  process.exit(0);
} else if (command === "dry-run") {
  const { report, paths } = dryRun(taskFile, {
    ...(runsDir ? { runsDir } : {}),
    ...(stateDir ? { stateDir } : {}),
  });
  console.log(`run       ${report.runId}`);
  console.log(`task      ${report.taskId}`);
  console.log(`base      ${report.baseCommit ?? "(none)"}`);
  console.log(`head      ${report.currentCommit ?? "(unknown)"}`);
  console.log(`clean     ${report.repositoryClean}`);
  console.log(`branch    ${report.proposedBranch ?? "(not planned)"}`);
  console.log(`worktree  ${report.proposedWorktree ?? "(not planned)"}`);
  console.log(`checks    ${report.requiredChecks.join(", ") || "(none)"}`);
  console.log(`protected ${report.protectedActions.join(", ") || "(none)"}`);
  console.log(`approval  ${report.approval.status}`);
  console.log(`taskHash  ${report.approval.taskHash ?? "(not hashed)"}`);
  console.log(`approvals ${approvalsDir({ stateDir })}`);
  for (const note of report.notes) console.log(`note      ${note}`);
  console.log(`report    ${paths.jsonPath}`);
  console.log(`report    ${paths.markdownPath}`);
  console.log(`status    ${report.finalStatus}`);
  process.exit(OK_STATUSES.includes(report.finalStatus) ? 0 : 1);
} else if (command === "orchestrate" || (command === "resume" && taskFile)) {
  // V2: one goal, carried across as many worker steps as it takes. `resume` and
  // `orchestrate` are the same call — the stored state decides whether this is a
  // first run or a continuation, because guessing that from a flag is how a
  // second worktree gets created for a goal that already had one.
  process.exit(printOrchestration(await orchestrate(taskFile, orchestratorOpts())));
} else if (command === "status" || command === "report") {
  const { state, store, error } = loadTaskState(taskFile, orchestratorOpts());
  if (error || !state) {
    console.error(`error     ${error ?? `no orchestration state for ${taskFile}`}`);
    console.error("detail    run `agent:orchestrate` first, or pass the task file path");
    process.exit(1);
  }
  if (command === "status") {
    console.log(statusBlock(state));
    process.exit(0);
  }
  const markdown = finalReportMarkdown(state);
  const file = store.saveFinalReport(markdown);
  console.log(markdown);
  console.log(`\nreport    ${file}`);
  process.exit(0);
} else if (command === "verify") {
  const criteria = (flagValue("--criteria") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (criteria.length === 0) {
    console.error('usage: verify --task <TASK-ID> --criteria C1,C2 --by "Full Name"');
    process.exit(1);
  }
  const result = verifyCriteria(taskFile, { criteria, by: approvedBy }, orchestratorOpts());
  if (!result.ok) {
    console.error(`error     ${result.error}`);
    process.exit(1);
  }
  console.log(`verified  ${result.marked.join(", ") || "(nothing new)"} by ${approvedBy}`);
  console.log(`task      ${result.state.taskId}`);
  console.log("\nRe-run `agent:resume --task <id>` to let the goal continue.");
  process.exit(0);
} else if (command === "run" || command === "resume") {
  if (command === "resume" && !runId) {
    console.error(usage);
    process.exit(1);
  }
  try {
    const { run, reportPath } =
      command === "run"
        ? await runTask(taskFile, engineOptions())
        : await resumeRun(runId, engineOptions());
    printRun(run, reportPath);
    process.exit(RUN_OK.includes(run.state) ? 0 : 1);
  } catch (error) {
    // The engine records adapter and workspace faults as terminal run states.
    // Anything reaching here is a bug in the runner itself; report it as one
    // line rather than a stack trace, and never as a partial success.
    console.error(`state     FAILED (runner error)`);
    console.error(`detail    ${String(error?.message ?? error).split("\n")[0]}`);
    console.error(
      "\nNo model was invoked by this failure path. Nothing was committed or deployed.",
    );
    process.exit(1);
  }
} else {
  console.error(`unknown command: ${command}`);
  console.error(usage);
  process.exit(1);
}
