// Persistent orchestration state, OUTSIDE the repository.
//
//   <repo>-agent-state/task-state/<TASK-ID>/
//     state.json          the live goal: status, criteria, blocker, evidence
//     checkpoints/        one snapshot per orchestration step
//     evidence/           full payload behind each evidence entry
//     final-report.md     written once, when the goal stops
//
// Why outside: the goal survives across runs, branches and interruptions, and a
// V1 run directory (project/runs/<run-id>/, in-repo) describes ONE invocation.
// Orchestration state that lived in the working tree would also dirty it, which
// the preflight refuses to run against.
//
// Writes are atomic — temp file, then rename — so a process killed mid-write
// leaves the last good state rather than a truncated one. That is the whole
// difference between a resumable goal and a corrupt one.
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { stateRoot } from "./approval.mjs";
import { redact, redactDeep } from "./redact.mjs";
import { writeAtomic } from "./runstore.mjs";
import { CRITERION_STATUSES, DEFAULT_BUDGET } from "./schemas.mjs";

export const STATE_VERSION = 2;

/** <state-root>/task-state — where every goal's state lives. */
export const taskStateRoot = (opts = {}) =>
  path.join(opts.stateRoot ? path.resolve(opts.stateRoot) : stateRoot(opts), "task-state");

const writeJson = (file, value) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);

/* ── Success criteria ────────────────────────────────────────────────────── */

/**
 * Which criteria this agent can actually prove on its own.
 *
 * ponytail: a small regex table rather than a criterion DSL. A task that needs
 * something else declares `successCriteria: [{ text, verifiedBy }]` explicitly
 * and skips the guessing entirely.
 *
 * Everything not matched here is `manual` — including "a customer receives the
 * right reply", which is the whole reason this table stays conservative. An
 * automatic verifier that lies is worse than a human checkbox.
 */
const AUTOMATIC_VERIFIERS = [
  [/typecheck|type check|tsc\b/i, "repo.checks.typecheck"],
  [/\blint\b|eslint/i, "repo.checks.lint"],
  [/\bbuilds?\b|build passes/i, "repo.checks.build"],
  [/codex|independent review|reviewer/i, "review.codex"],
];

/** Boundary that proves a criterion automatically, or null for manual. */
export function verifierFor(text) {
  for (const [pattern, boundary] of AUTOMATIC_VERIFIERS) {
    if (pattern.test(text)) return boundary;
  }
  return null;
}

/**
 * Build the criterion list for a task.
 *
 * V2 tasks may declare `successCriteria`. Legacy tasks have only
 * `acceptanceCriteria`, and those are used unchanged — the point of the V2
 * schema being optional is that ATLAS-001..004 still work.
 */
export function successCriteriaFor(task) {
  const declared = Array.isArray(task?.successCriteria) ? task.successCriteria : null;
  const source =
    declared ?? (Array.isArray(task?.acceptanceCriteria) ? task.acceptanceCriteria : []);

  return source.map((entry, index) => {
    const text = typeof entry === "string" ? entry : (entry?.text ?? "");
    const declaredBoundary = typeof entry === "object" ? (entry?.verifiedBy ?? null) : null;
    return {
      id: (typeof entry === "object" && entry?.id) || `C${index + 1}`,
      text,
      // An explicit `verifiedBy` wins; otherwise the table decides; otherwise
      // it is a human's job and says so.
      verifiedBy: declaredBoundary ?? verifierFor(text),
      status: "pending",
      evidenceIds: [],
      verifiedAt: null,
    };
  });
}

/* ── State ───────────────────────────────────────────────────────────────── */

/** A fresh goal. Nothing has been attempted, nothing is verified. */
export function createTaskState({ task, taskFile, now = new Date(), budget, lessons = [] }) {
  const at = now.toISOString();
  return {
    stateVersion: STATE_VERSION,
    taskId: task.taskId,
    taskFile: String(taskFile ?? "").replace(/\\/g, "/"),
    goal: task.goal ?? task.objective ?? task.title,
    status: "pending",
    successCriteria: successCriteriaFor(task),
    verifiedBoundaries: [],
    currentBlocker: null,
    activeWorker: null,
    // `total` is every worker result; `steps` is the strategic budget, which an
    // infrastructure pause does not spend. See orchestrator.consumesStrategicStep.
    attempts: { total: 0, steps: 0, byWorker: {}, sameFailure: 0 },
    evidence: [],
    nextAction: "read-only preflight",
    approvalsPending: [],
    lastProgressAt: at,
    stopReason: null,
    createdAt: at,
    updatedAt: at,
    budget: { ...DEFAULT_BUDGET, ...(task.budget ?? {}), ...(budget ?? {}) },
    lessons,
    lastFingerprint: null,
    // The V1 run this goal is currently using, so a resume knows which worktree
    // to continue in rather than creating a second one.
    activeRun: null,
    history: [],
  };
}

/** Evidence id: stable for identical evidence, so a repeat is detectable. */
export const evidenceId = (entry) =>
  createHash("sha256")
    .update(`${entry.worker}|${entry.action}|${entry.kind}|${entry.summary}`)
    .digest("hex")
    .slice(0, 12);

/**
 * Append evidence, skipping anything already recorded.
 *
 * The de-duplication is load-bearing: "was there new evidence?" is what decides
 * whether the loop may try the same thing again, so identical evidence must not
 * be able to look new by being written twice.
 *
 * @returns {{ state, added: object[] }}
 */
export function addEvidence(state, entries, now = new Date()) {
  const known = new Set(state.evidence.map((e) => e.id));
  const added = [];
  for (const entry of entries) {
    const scrubbed = { ...entry, summary: redact(String(entry.summary ?? "")) };
    const id = entry.id ?? evidenceId(scrubbed);
    if (known.has(id)) continue;
    known.add(id);
    const record = {
      id,
      at: now.toISOString(),
      worker: scrubbed.worker ?? state.activeWorker,
      action: scrubbed.action ?? null,
      kind: scrubbed.kind ?? "note",
      summary: scrubbed.summary,
      ref: scrubbed.ref ?? null,
    };
    state.evidence.push(record);
    added.push({ ...record, payload: entry.payload ?? null });
  }
  return { state, added };
}

/**
 * Mark criteria proven by the boundaries verified so far.
 *
 * Nothing here can mark a `manual` criterion verified — that requires a human,
 * and the report says so by name. "Tests passed" is not "the goal is met".
 */
export function applyVerification(state, now = new Date()) {
  const verified = new Set(state.verifiedBoundaries);
  for (const criterion of state.successCriteria) {
    if (criterion.status === "verified" || !criterion.verifiedBy) continue;
    // A boundary proves a criterion when it, or a boundary it is a prefix of,
    // has been verified: "repo.checks" proves "repo.checks.typecheck".
    const proven = [...verified].some(
      (boundary) =>
        boundary === criterion.verifiedBy || criterion.verifiedBy.startsWith(`${boundary}.`),
    );
    if (!proven) continue;
    criterion.status = "verified";
    criterion.verifiedAt = now.toISOString();
    criterion.evidenceIds = state.evidence.slice(-3).map((e) => e.id);
  }
  return state;
}

/** Criteria that no automatic verifier can ever prove. */
export const manualCriteria = (state) =>
  state.successCriteria.filter((c) => !c.verifiedBy && c.status !== "verified");

/** Are all criteria proven? Manual ones are never "proven" by the agent. */
export const allCriteriaVerified = (state) =>
  state.successCriteria.length > 0 && state.successCriteria.every((c) => c.status === "verified");

/**
 * Freeze the goal at a stopping point. Manual criteria are marked for what they
 * are instead of being quietly left `pending` in a completed report.
 */
export function stop(state, { status, stopReason, nextAction = null }, now = new Date()) {
  state.status = status;
  state.stopReason = stopReason;
  state.nextAction = nextAction ?? state.nextAction;
  state.activeWorker = null;
  state.updatedAt = now.toISOString();
  // Once the goal has stopped on verification, a criterion with no automatic
  // verifier is never going to become verified on its own. Say so by name
  // rather than leaving it "pending", which reads as "not looked at yet".
  if (status !== "completed" && stopReason !== "manual_verification_required") return state;
  for (const criterion of state.successCriteria) {
    if (criterion.status === "pending" && !criterion.verifiedBy) {
      criterion.status = "manual_verification_required";
    }
  }
  return state;
}

/* ── Store ───────────────────────────────────────────────────────────────── */

export class TaskStateStore {
  constructor(taskId, root) {
    this.taskId = taskId;
    this.root = root;
    this.dir = path.join(root, taskId);
    for (const sub of ["checkpoints", "evidence"]) {
      mkdirSync(path.join(this.dir, sub), { recursive: true });
    }
  }

  /** Open (creating if absent) the store for a task id. */
  static open(taskId, root) {
    return new TaskStateStore(taskId, root);
  }

  /** Every task id with stored state. */
  static list(root) {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  file(...parts) {
    return path.join(this.dir, ...parts);
  }

  get stateFile() {
    return this.file("state.json");
  }

  /** Stored state, or null when this goal has never run. */
  load() {
    if (!existsSync(this.stateFile)) return null;
    return JSON.parse(readFileSync(this.stateFile, "utf8"));
  }

  save(state, now = new Date()) {
    state.updatedAt = now.toISOString();
    writeJson(this.stateFile, state);
    return state;
  }

  /** Immutable snapshot of the goal after a step. Never overwritten. */
  checkpoint(state) {
    const index = String(state.attempts.total).padStart(4, "0");
    const file = this.file("checkpoints", `${index}-${state.activeWorker ?? "none"}.json`);
    writeJson(file, state);
    return file;
  }

  checkpoints() {
    const dir = this.file("checkpoints");
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  /** Full evidence payload, scrubbed. The state carries only the summary. */
  saveEvidence(entry) {
    const file = this.file("evidence", `${entry.id}.json`);
    writeJson(file, redactDeep({ ...entry, payload: entry.payload ?? null }));
    return file;
  }

  saveFinalReport(markdown) {
    const file = this.file("final-report.md");
    writeAtomic(file, markdown);
    return file;
  }
}

/** Criterion status vocabulary, re-exported so callers need one import. */
export { CRITERION_STATUSES };
