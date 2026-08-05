#!/usr/bin/env node
// Atlas Development Agent CLI.
//
//   npm run agent:validate -- --task project/tasks/ATLAS-001.json
//   npm run agent:dry-run  -- --task project/tasks/ATLAS-001.json
//
// Exit codes:
//   0  validate: task is structurally valid
//      dry-run:  READY_TO_RUN or READY_FOR_APPROVAL (a controlled, safe stop)
//   1  everything else — invalid task, blocked permission, commit mismatch,
//      dirty repository, unexpected failure, or CLI misuse
import { dryRun, OK_STATUSES, validate } from "./coordinator.mjs";

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const flagValues = new Set([flagValue("--task"), flagValue("--runs-dir")]);
const command = argv.find((arg) => !arg.startsWith("--") && !flagValues.has(arg));
const taskFile = flagValue("--task");
// --runs-dir keeps the test suite out of project/runs; production runs omit it.
const runsDir = flagValue("--runs-dir");

if (!command || !taskFile) {
  console.error("usage: node agent/cli.mjs <validate|dry-run> --task <path/to/task.json>");
  process.exit(1);
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
} else {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}
