// Run reports. Every run writes the same payload twice: JSON for machines,
// Markdown for the human doing the review.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RUNS_DIR = path.join("project", "runs");

/** run-20260805T101112Z-ATLAS-001 */
export function makeRunId(taskId, timestamp) {
  const stamp = timestamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `run-${stamp}-${taskId}`;
}

const list = (items) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- (none)");

const block = (text) => (text ? "```\n" + text + "\n```" : "_clean_");

const gateLines = (gates) =>
  list(gates.map((g) => `${g.ok ? "PASS" : "FAIL"} \`${g.name}\` — ${g.detail}`));

const checkLines = (results) =>
  list(
    results.map((r) => {
      const counts =
        r.result === "PASS"
          ? ""
          : ` (${r.newFailures?.length ?? 0} new, ${r.baselineFailures?.length ?? 0} baseline)`;
      return `\`${r.name}\` — **${r.result}**${counts}`;
    }),
  );

function toMarkdown(report) {
  return `# Agent run ${report.runId}

| Field | Value |
| --- | --- |
| Task | ${report.taskId} |
| Task file | ${report.taskFile} |
| Timestamp | ${report.timestamp} |
| Mode | ${report.mode} |
| Base commit | ${report.baseCommit} |
| Current commit | ${report.currentCommit} |
| Repository clean | ${report.repositoryClean} |
| Validation | ${report.validation.valid ? "valid" : "invalid"} |
| Approved | ${report.approval.approved} |
| Proposed branch | ${report.proposedBranch ?? "(not planned)"} |
| Proposed worktree | ${report.proposedWorktree ?? "(not planned)"} |
| Worktree state | ${report.worktreeState ?? "(not inspected)"} |
| Authorizes execution | ${report.authorizes === true} |
| **Final status** | **${report.finalStatus}** |

## Repository status

${block(report.repositoryStatus)}

## Validation errors

${list(report.validation.errors)}

## Required checks

${list(report.requiredChecks)}

## Check results

${checkLines(report.checkResults ?? [])}

## Execution preflight gates

${gateLines(report.executionGates ?? [])}

## Protected actions detected

${list(report.protectedActions)}

## Notes

${list(report.notes)}

_No branch, worktree, commit, push or deployment was created by this run._
_This report does not authorize execution: an approved run re-runs the preflight itself._
`;
}

/**
 * Write the JSON and Markdown reports.
 *
 * @returns {{ jsonPath: string, markdownPath: string }}
 */
export function writeReport(report, dir = RUNS_DIR) {
  mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${report.runId}.json`);
  const markdownPath = path.join(dir, `${report.runId}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(markdownPath, toMarkdown(report));
  return { jsonPath, markdownPath };
}
