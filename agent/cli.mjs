#!/usr/bin/env node
// Atlas Development Agent CLI.
//
//   npm run agent:validate -- --task project/tasks/ATLAS-001.json
//   npm run agent:dry-run  -- --task project/tasks/ATLAS-001.json
//   npm run agent:run      -- --task project/tasks/ATLAS-001.json
//   npm run agent:resume   -- --run run-20260805T101112Z-ATLAS-001
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
import { dryRun, OK_STATUSES, validate } from "./coordinator.mjs";
import { resumeRun, runTask } from "./engine.mjs";
import { phaseOf } from "./schemas.mjs";

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const FLAGS = ["--task", "--runs-dir", "--run", "--max-retries", "--retry-ms"];
const flagValues = new Set(FLAGS.map(flagValue).filter(Boolean));
const command = argv.find((arg) => !arg.startsWith("--") && !flagValues.has(arg));
const taskFile = flagValue("--task");
const runId = flagValue("--run");
// --runs-dir keeps the test suites out of project/runs; production runs omit it.
const runsDir = flagValue("--runs-dir");
const noResume = argv.includes("--no-auto-resume");

const usage =
  "usage: node agent/cli.mjs <validate|dry-run|run> --task <task.json>\n" +
  "       node agent/cli.mjs resume --run <run-id>";

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
  ...(noResume ? { autoResume: false } : {}),
  ...(flagValue("--max-retries") ? { maxRetries: Number(flagValue("--max-retries")) } : {}),
  ...(flagValue("--retry-ms") ? { retryMs: Number(flagValue("--retry-ms")) } : {}),
});

if (!command) {
  console.error(usage);
  process.exit(1);
}

if (command === "validate" || command === "dry-run" || command === "run") {
  if (!taskFile) {
    console.error(usage);
    process.exit(1);
  }
}

if (command === "validate") {
  const result = validate(taskFile);
  if (result.valid) {
    console.log(`VALID   ${taskFile} (${result.task.taskId})`);
    if (result.task.approved !== true) {
      console.log("NOTE    task is not approved — dry-run will stop at READY_FOR_APPROVAL");
    }
    process.exit(0);
  }
  console.error(`INVALID ${taskFile}`);
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
} else if (command === "dry-run") {
  const { report, paths } = dryRun(taskFile, runsDir ? { runsDir } : {});
  console.log(`run       ${report.runId}`);
  console.log(`task      ${report.taskId}`);
  console.log(`base      ${report.baseCommit ?? "(none)"}`);
  console.log(`head      ${report.currentCommit ?? "(unknown)"}`);
  console.log(`clean     ${report.repositoryClean}`);
  console.log(`branch    ${report.proposedBranch ?? "(not planned)"}`);
  console.log(`worktree  ${report.proposedWorktree ?? "(not planned)"}`);
  console.log(`checks    ${report.requiredChecks.join(", ") || "(none)"}`);
  console.log(`protected ${report.protectedActions.join(", ") || "(none)"}`);
  for (const note of report.notes) console.log(`note      ${note}`);
  console.log(`report    ${paths.jsonPath}`);
  console.log(`report    ${paths.markdownPath}`);
  console.log(`status    ${report.finalStatus}`);
  process.exit(OK_STATUSES.includes(report.finalStatus) ? 0 : 1);
} else if (command === "run") {
  const { run, reportPath } = await runTask(taskFile, engineOptions());
  printRun(run, reportPath);
  process.exit(RUN_OK.includes(run.state) ? 0 : 1);
} else if (command === "resume") {
  if (!runId) {
    console.error(usage);
    process.exit(1);
  }
  const { run, reportPath } = await resumeRun(runId, engineOptions());
  printRun(run, reportPath);
  process.exit(RUN_OK.includes(run.state) ? 0 : 1);
} else {
  console.error(`unknown command: ${command}`);
  console.error(usage);
  process.exit(1);
}
