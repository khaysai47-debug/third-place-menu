// Durable run directory: project/runs/<run-id>/
//
//   run.json            live run state, rewritten at every stage
//   checkpoint.json     what a resume needs, rewritten at every stage
//   task-snapshot.json  the task exactly as approved, frozen at run start
//   builder/            raw Builder stdout/stderr per round
//   reviewer/           raw Reviewer output per round
//   checks/             per-check logs
//   diff.patch          the Builder's unified diff
//   final-report.md     the human-readable outcome
//
// Writes are atomic: content goes to a temp file in the same directory, then
// rename() swaps it in. A process killed mid-write leaves the previous good
// file, not a truncated one — which is the difference between a resumable run
// and a corrupt one.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { phaseOf } from "./schemas.mjs";

export const RUNS_ROOT = path.join("project", "runs");

/** run-20260805T101112Z-ATLAS-001 */
export function makeRunId(taskId, timestamp = new Date().toISOString()) {
  const stamp = timestamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `run-${stamp}-${taskId}`;
}

export function writeAtomic(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, content);
  renameSync(temp, file);
}

const writeJson = (file, value) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);

export class RunStore {
  constructor(runId, root = RUNS_ROOT) {
    this.runId = runId;
    this.dir = path.join(root, runId);
    for (const sub of ["builder", "reviewer", "checks"]) {
      mkdirSync(path.join(this.dir, sub), { recursive: true });
    }
  }

  static open(runId, root = RUNS_ROOT) {
    const dir = path.join(root, runId);
    if (!existsSync(dir)) throw new Error(`no such run: ${runId}`);
    return new RunStore(runId, root);
  }

  /** Every run directory under `root`, newest first. */
  static list(root = RUNS_ROOT) {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  }

  file(...parts) {
    return path.join(this.dir, ...parts);
  }

  saveRun(run) {
    writeJson(this.file("run.json"), run);
  }

  loadRun() {
    return JSON.parse(readFileSync(this.file("run.json"), "utf8"));
  }

  saveCheckpoint(checkpoint) {
    writeJson(this.file("checkpoint.json"), checkpoint);
  }

  loadCheckpoint() {
    return JSON.parse(readFileSync(this.file("checkpoint.json"), "utf8"));
  }

  saveTaskSnapshot(task) {
    writeJson(this.file("task-snapshot.json"), task);
  }

  loadTaskSnapshot() {
    return JSON.parse(readFileSync(this.file("task-snapshot.json"), "utf8"));
  }

  /** Raw Builder transcript for one round. Never contains credentials. */
  saveBuilderRound(round, result) {
    const base = `round-${round}`;
    writeAtomic(this.file("builder", `${base}.stdout.txt`), result.stdout ?? "");
    writeAtomic(this.file("builder", `${base}.stderr.txt`), result.stderr ?? "");
    writeJson(this.file("builder", `${base}.json`), {
      outcome: result.outcome,
      detail: result.detail ?? null,
      exitCode: result.exitCode ?? null,
      durationMs: result.durationMs ?? null,
      sessionId: result.sessionId ?? null,
      numTurns: result.numTurns ?? null,
      report: result.report ?? null,
      command: result.command ?? null,
    });
    return this.file("builder", `${base}.json`);
  }

  saveReviewerRound(round, result) {
    const base = `round-${round}`;
    writeAtomic(this.file("reviewer", `${base}.output.txt`), result.lastMessage ?? "");
    writeJson(this.file("reviewer", `${base}.json`), {
      outcome: result.outcome,
      error: result.error ?? null,
      exitCode: result.exitCode ?? null,
      durationMs: result.durationMs ?? null,
      review: result.review ?? null,
      command: result.command ?? null,
    });
    return this.file("reviewer", `${base}.json`);
  }

  saveCheckLog(round, check) {
    const file = this.file("checks", `round-${round}-${check.name}.log`);
    writeAtomic(file, check.log ?? JSON.stringify(check, null, 2));
    return file;
  }

  saveDiff(patch) {
    writeAtomic(this.file("diff.patch"), patch ?? "");
  }

  saveFinalReport(markdown) {
    writeAtomic(this.file("final-report.md"), markdown);
    return this.file("final-report.md");
  }
}

/** Build a checkpoint from live run state. Shape matches CHECKPOINT_FIELDS. */
export function toCheckpoint(run) {
  return {
    runId: run.runId,
    taskId: run.taskId,
    stage: run.stage,
    builderSessionId: run.builderSessionId ?? null,
    worktreePath: run.worktree ?? "",
    baseCommit: run.baseCommit ?? "",
    currentCommit: run.currentCommit ?? "",
    implementationRound: run.implementationRound ?? 0,
    revisionRound: run.revisionRound ?? 0,
    filesChanged: run.filesChanged ?? [],
    lastSuccessfulStage: run.lastSuccessfulStage ?? null,
    pauseReason: run.pauseReason ?? null,
    expectedRetryAt: run.expectedRetryAt ?? null,
    retryCount: run.retryCount ?? 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Record a notification event on the run. Nothing is sent anywhere — no SMS, no
 * email, no Messenger. The events sit in run.json so a future Agent OS can
 * display them. Deliberate: an agent that can message people is a different
 * safety problem than one that cannot.
 */
export function notify(run, event, message) {
  run.notifications = run.notifications ?? [];
  run.notifications.push({ event, message, at: new Date().toISOString() });
  return run;
}

const list = (items) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)");

export function finalReportMarkdown(run) {
  const checkRows = (run.checkResults ?? [])
    .map(
      (c) =>
        `| \`${c.name}\` | ${c.result} | ${c.newFailures?.length ?? 0} | ` +
        `${c.baselineFailures?.length ?? 0} | ${c.durationMs ?? "-"}ms |`,
    )
    .join("\n");

  const findings = (run.findings ?? [])
    .map(
      (f) =>
        `- **[${f.id}]** ${f.severity}/${f.category}${f.file ? ` — \`${f.file}\`` : ""}\n` +
        `  - evidence: ${f.evidence}\n  - required: ${f.requiredCorrection}`,
    )
    .join("\n");

  return `# Run ${run.runId}

| Field | Value |
| --- | --- |
| Task | ${run.taskId} |
| Final state | **${run.state}** (${phaseOf(run.state)}) |
| Stage reached | ${run.stage ?? "(none)"} (last good: ${run.lastSuccessfulStage ?? "none"}) |
| Error category | ${run.errorCategory ?? "(none)"} |
| Error | ${run.errorMessage ?? "(none)"} |
| Worktree created | ${run.worktreeCreated === true} |
| Model invoked | ${run.modelInvoked === true} |
| Reviewer verdict | ${run.reviewVerdict ?? "(none)"} |
| Base commit | ${run.baseCommit} |
| Branch | ${run.branch ?? "(none)"} |
| Worktree | ${run.worktree ?? "(none)"} |
| Implementation rounds | ${run.implementationRound ?? 0} |
| Revision rounds | ${run.revisionRound ?? 0} of ${run.maxRevisionRounds ?? 2} |
| Retries (pauses) | ${run.retryCount ?? 0} |
| Started | ${run.startedAt} |
| Ended | ${run.endedAt ?? "(still open)"} |

## Changed files

${list(run.filesChanged ?? [])}

## Checks

${checkRows ? `| Check | Result | New | Baseline | Duration |\n| --- | --- | --- | --- | --- |\n${checkRows}` : "_none run_"}

## Reviewer findings

${findings || "- (none)"}

## Notifications

${list((run.notifications ?? []).map((n) => `${n.at} **${n.event}** — ${n.message}`))}

## Notes

${list(run.notes ?? [])}

---

_Nothing was committed, pushed, merged or deployed. The worktree is preserved at
\`${run.worktree ?? "(none)"}\` for human inspection._
`;
}
