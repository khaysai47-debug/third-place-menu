// Task schema and permission vocabulary for the Atlas Development Agent.
//
// A task is a plain JSON object. Validation returns human-readable errors
// instead of throwing, so the CLI can print every problem in one pass.
// ponytail: hand-written checks, no schema library — the shape is fixed and
// small. Swap in zod (already a dependency) if tasks ever grow nested objects.

/** Permission tiers. See project/PERMISSIONS.md for the prose version. */
export const PERMISSION_TIERS = {
  // Granted automatically once a task is approved.
  automatic: [
    "read_repository",
    "plan_workspace",
    "edit_task_workspace",
    "run_checks",
    "inspect_local_logs",
    "review_local_diff",
    "prepare_reports",
    // V2: READ-ONLY inspection of an external system through a configured
    // connector — an n8n execution, a Vercel deployment log, the presence (not
    // the value) of a required env var. Reads only. Every change to an external
    // system stays Tier 2 or Tier 3, and a task that does not list this
    // permission gets no external inspection at all.
    "inspect_external_system",
  ],
  // Requires an explicit human approval, per action, per task.
  approval: [
    "commit",
    "push",
    "pull_request",
    "n8n_change",
    "supabase_data_change",
    "project_rule_update",
    "merge",
  ],
  // Requires a critical, named human approval. Never inferred, never batched.
  critical: [
    "production_deploy",
    "database_schema_change",
    "secret_rotation",
    "deletion",
    "customer_message",
    "order_or_payment",
    "destructive_production_action",
  ],
};

export const ALL_PERMISSIONS = Object.values(PERMISSION_TIERS).flat();

/** Anything the local runner must refuse to perform on its own. */
export const PROTECTED_PERMISSIONS = [...PERMISSION_TIERS.approval, ...PERMISSION_TIERS.critical];

/** Checks the runner may execute. `format` is excluded: it rewrites files. */
export const ALLOWED_CHECKS = ["typecheck", "lint", "build"];

export const RISK_LEVELS = ["low", "medium", "high", "critical"];

export const FINAL_STATUSES = [
  "READY_FOR_APPROVAL",
  "READY_TO_RUN",
  "BLOCKED_PERMISSION",
  "INVALID_TASK",
  "BASE_COMMIT_MISMATCH",
  "DIRTY_REPOSITORY",
  "WORKTREE_CONFLICT",
  "BRANCH_EXISTS",
  "APPROVAL_MISSING",
  "APPROVAL_INVALID",
  "APPROVAL_STALE",
  "ADAPTER_CONFIGURATION_ERROR",
  "FAILED",
];

/**
 * States an execution run can end a stage in, beyond the preflight statuses.
 *
 * - `PASS`                   — review passed and the task produced no file
 *                              changes. Nothing for a human to commit.
 * - `READY_FOR_HUMAN_REVIEW` — review passed and a diff is waiting in the
 *                              worktree for a human to inspect and commit.
 * - `CHECKS_FAILED`          — a required check ended in NEW_FAILURE and the
 *                              revision budget is spent.
 * - `SCOPE_VIOLATION`        — the Builder touched a path outside allowedPaths
 *                              or inside forbiddenPaths.
 * - `NEEDS_HUMAN`            — unresolved disagreement, malformed reviewer
 *                              output, revision budget spent, or a repeated
 *                              identical failure.
 */
export const EXECUTION_STATES = [
  "RUNNING",
  "PASS",
  "READY_FOR_HUMAN_REVIEW",
  "CHECKS_FAILED",
  "SCOPE_VIOLATION",
  "NEEDS_HUMAN",
];

/**
 * Recoverable pauses. A pause is NOT a failure: the run is intact and waiting
 * on something outside the agent's control. See project/PAUSE_RESUME.md.
 *
 * `PAUSED_BUILDER_BUDGET` is the ATLAS-004 lesson made structural: a Builder
 * that spends its turn limit has not failed at the work, it has run out of
 * turns mid-way through it. The worktree holds real, often correct changes.
 * Throwing that away and starting again is the expensive wrong answer, so the
 * state is a pause and the resume continues in the SAME worktree.
 */
export const PAUSE_STATES = [
  "PAUSED_USAGE_LIMIT",
  "PAUSED_AUTH_REQUIRED",
  "PAUSED_NETWORK_ERROR",
  "PAUSED_BUILDER_BUDGET",
  "RESUME_SCHEDULED",
  "RESUMING",
];

export const RUN_STATES = [...FINAL_STATUSES, ...PAUSE_STATES, ...EXECUTION_STATES];

/**
 * Every run state, classified. `active` means work is in flight, `paused` means
 * recoverable and waiting, `terminal` means the run is over.
 */
export const STATE_PHASE = {
  RUNNING: "active",
  RESUMING: "active",

  PAUSED_USAGE_LIMIT: "paused",
  PAUSED_AUTH_REQUIRED: "paused",
  PAUSED_NETWORK_ERROR: "paused",
  PAUSED_BUILDER_BUDGET: "paused",
  RESUME_SCHEDULED: "paused",

  PASS: "terminal",
  READY_FOR_HUMAN_REVIEW: "terminal",
  CHECKS_FAILED: "terminal",
  SCOPE_VIOLATION: "terminal",
  NEEDS_HUMAN: "terminal",
  READY_FOR_APPROVAL: "terminal",
  READY_TO_RUN: "terminal",
  BLOCKED_PERMISSION: "terminal",
  INVALID_TASK: "terminal",
  BASE_COMMIT_MISMATCH: "terminal",
  DIRTY_REPOSITORY: "terminal",
  WORKTREE_CONFLICT: "terminal",
  BRANCH_EXISTS: "terminal",
  APPROVAL_MISSING: "terminal",
  APPROVAL_INVALID: "terminal",
  APPROVAL_STALE: "terminal",
  ADAPTER_CONFIGURATION_ERROR: "terminal",
  FAILED: "terminal",
};

/**
 * Error categories recorded on a run. A category answers "what kind of thing
 * went wrong", so a human can tell a misconfigured runner from a bad task from
 * a model that could not do the work.
 */
export const ERROR_CATEGORIES = [
  "adapter_configuration",
  "workspace",
  "builder",
  "reviewer",
  "checks",
  "scope",
  "approval",
  "git",
];

export const phaseOf = (state) => STATE_PHASE[state] ?? "unknown";

/** Reviewer verdicts. Anything else is malformed output and is rejected. */
export const REVIEW_VERDICTS = ["PASS", "REVISE", "NEEDS_HUMAN"];

export const FINDING_SEVERITIES = ["blocker", "major", "minor"];

/**
 * How a Builder invocation ended. Pause outcomes are recoverable and do not
 * consume a revision round; the rest are the run's own problem.
 */
export const BUILDER_OUTCOMES = [
  "success",
  "implementation_failure",
  // Turn budget spent mid-implementation. NOT an implementation failure: the
  // work in the worktree may be complete, correct, or nearly so (ATLAS-004 was
  // all three). Resumable, and resumed in the same worktree.
  "turn_limit",
  "usage_limit",
  "auth_failure",
  "network_failure",
  "malformed_output",
  "timeout",
  // The CLI never launched — a runner fault, distinct from a model that failed.
  "process_spawn_error",
];

/** Builder outcomes that pause rather than fail, and the state each maps to. */
export const PAUSING_OUTCOMES = {
  usage_limit: "PAUSED_USAGE_LIMIT",
  auth_failure: "PAUSED_AUTH_REQUIRED",
  network_failure: "PAUSED_NETWORK_ERROR",
};

/**
 * Notification events recorded on the run so a future Agent OS can display
 * them. Nothing is sent anywhere — no SMS, email or Messenger. Deliberate.
 */
export const NOTIFICATION_EVENTS = [
  "paused",
  "resume_scheduled",
  "resumed",
  "completed",
  "blocked",
];

/** Which pause state a reason maps to. */
export const PAUSE_REASONS = {
  usage_limit: "PAUSED_USAGE_LIMIT",
  auth_required: "PAUSED_AUTH_REQUIRED",
  network_error: "PAUSED_NETWORK_ERROR",
  builder_budget_exhausted: "PAUSED_BUILDER_BUDGET",
};

/**
 * Outcome of a single check.
 *
 * - `PASS`             — the check succeeded.
 * - `NEW_FAILURE`      — a failure this run is accountable for. Blocking.
 * - `BASELINE_FAILURE` — a failure that already existed at the base commit and
 *                        was not made worse. Visible, tracked, non-blocking.
 *
 * See project/TEST_MATRIX.md and decision D-009.
 */
export const CHECK_RESULTS = ["PASS", "NEW_FAILURE", "BASELINE_FAILURE"];

/**
 * Checkpoint written on every stage boundary and on every pause, so a paused
 * run can be resumed instead of restarted. Schema only in this bootstrap —
 * nothing writes checkpoints yet.
 */
export const CHECKPOINT_FIELDS = [
  "runId",
  "taskId",
  "stage",
  "builderSessionId",
  "worktreePath",
  "baseCommit",
  "currentCommit",
  "implementationRound",
  "revisionRound",
  "filesChanged",
  "lastSuccessfulStage",
  "pauseReason",
  "expectedRetryAt",
  "retryCount",
  "updatedAt",
];

/** Stages a run moves through. `stage` and `lastSuccessfulStage` use these. */
export const STAGES = [
  "planning",
  "implementation",
  "checks",
  "review",
  "revision",
  "reporting",
  "complete",
];

const REQUIRED_STRINGS = ["taskId", "title", "objective", "context", "owner", "baseCommit"];

const REQUIRED_ARRAYS = [
  "allowedPaths",
  "forbiddenPaths",
  "acceptanceCriteria",
  "requiredChecks",
  "permissions",
  "stoppingRules",
];

// forbiddenPaths and permissions may legitimately be empty; the rest may not.
const MUST_BE_NON_EMPTY = ["allowedPaths", "acceptanceCriteria", "requiredChecks", "stoppingRules"];

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Validate a task object.
 *
 * A task file is a pure SPECIFICATION. It carries no approval: consent lives in
 * an external receipt (see agent/approval.mjs and decision D-016). The three old
 * approval fields are therefore deprecated — tolerated as a warning so existing
 * drafts still validate, except `approved: true`, which is a hard error. A file
 * claiming to be approved would otherwise read as authorization to a human while
 * meaning nothing to the runner, which is the worst of both worlds.
 *
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateTask(task) {
  const errors = [];
  const warnings = [];
  if (task === null || typeof task !== "object" || Array.isArray(task)) {
    return { valid: false, errors: ["task must be a JSON object"], warnings };
  }

  for (const field of ["approved", "approvedAt", "approvedBy"]) {
    if (field in task) {
      warnings.push(`${field} is deprecated in task files — approval lives in an external receipt`);
    }
  }
  if (task.approved === true) {
    errors.push(
      "approved: true in a tracked task file does not authorize anything and must be removed — " +
        "run `npm run agent:approve` to create an external approval receipt instead",
    );
  }

  for (const field of REQUIRED_STRINGS) {
    if (!isNonEmptyString(task[field])) errors.push(`${field} must be a non-empty string`);
  }

  if (!RISK_LEVELS.includes(task.riskLevel)) {
    errors.push(`riskLevel must be one of: ${RISK_LEVELS.join(", ")}`);
  }

  if (isNonEmptyString(task.baseCommit) && !/^[0-9a-f]{40}$/.test(task.baseCommit)) {
    errors.push("baseCommit must be a full 40-character commit SHA");
  }

  for (const field of REQUIRED_ARRAYS) {
    const value = task[field];
    if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
      errors.push(`${field} must be an array of non-empty strings`);
      continue;
    }
    if (value.length === 0 && MUST_BE_NON_EMPTY.includes(field)) {
      errors.push(`${field} must not be empty`);
    }
  }

  if (Array.isArray(task.requiredChecks)) {
    for (const check of task.requiredChecks) {
      if (!ALLOWED_CHECKS.includes(check)) {
        errors.push(`requiredChecks contains unsupported check "${check}"`);
      }
    }
  }

  if (Array.isArray(task.permissions)) {
    for (const permission of task.permissions) {
      if (!ALL_PERMISSIONS.includes(permission)) {
        errors.push(`permissions contains unknown permission "${permission}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Permissions the task requests that the runner may never grant itself. */
export function protectedActions(task) {
  const requested = Array.isArray(task?.permissions) ? task.permissions : [];
  return requested.filter((permission) => PROTECTED_PERMISSIONS.includes(permission));
}

/**
 * Validate a checkpoint object.
 *
 * Nullable-when-not-applicable fields (`builderSessionId`, `pauseReason`,
 * `expectedRetryAt`, `lastSuccessfulStage`) must be present but may be null —
 * an absent key is a bug, an explicit null is a state.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCheckpoint(checkpoint) {
  const errors = [];
  if (checkpoint === null || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    return { valid: false, errors: ["checkpoint must be an object"] };
  }

  for (const field of CHECKPOINT_FIELDS) {
    if (!(field in checkpoint)) errors.push(`checkpoint is missing ${field}`);
  }

  for (const field of [
    "runId",
    "taskId",
    "worktreePath",
    "baseCommit",
    "currentCommit",
    "updatedAt",
  ]) {
    if (field in checkpoint && !isNonEmptyString(checkpoint[field])) {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  if ("stage" in checkpoint && !STAGES.includes(checkpoint.stage)) {
    errors.push(`stage must be one of: ${STAGES.join(", ")}`);
  }

  if (
    "lastSuccessfulStage" in checkpoint &&
    checkpoint.lastSuccessfulStage !== null &&
    !STAGES.includes(checkpoint.lastSuccessfulStage)
  ) {
    errors.push("lastSuccessfulStage must be null or a known stage");
  }

  for (const field of ["implementationRound", "revisionRound", "retryCount"]) {
    if (field in checkpoint && !Number.isInteger(checkpoint[field])) {
      errors.push(`${field} must be an integer`);
    }
  }

  if ("filesChanged" in checkpoint && !Array.isArray(checkpoint.filesChanged)) {
    errors.push("filesChanged must be an array");
  }

  if (
    "pauseReason" in checkpoint &&
    checkpoint.pauseReason !== null &&
    !(checkpoint.pauseReason in PAUSE_REASONS)
  ) {
    errors.push(`pauseReason must be null or one of: ${Object.keys(PAUSE_REASONS).join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a Reviewer verdict. Strict on purpose: a review the runner cannot
 * parse is rejected as malformed, never guessed at or coerced into a PASS.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateReview(review) {
  const errors = [];
  if (review === null || typeof review !== "object" || Array.isArray(review)) {
    return { valid: false, errors: ["review must be an object"] };
  }

  if (!REVIEW_VERDICTS.includes(review.verdict)) {
    errors.push(`verdict must be one of: ${REVIEW_VERDICTS.join(", ")}`);
  }

  if (!Array.isArray(review.findings)) {
    errors.push("findings must be an array");
    return { valid: false, errors };
  }

  review.findings.forEach((finding, index) => {
    const at = `findings[${index}]`;
    if (finding === null || typeof finding !== "object") {
      errors.push(`${at} must be an object`);
      return;
    }
    if (!isNonEmptyString(finding.id)) errors.push(`${at}.id must be a non-empty string`);
    if (!FINDING_SEVERITIES.includes(finding.severity)) {
      errors.push(`${at}.severity must be one of: ${FINDING_SEVERITIES.join(", ")}`);
    }
    if (!isNonEmptyString(finding.category)) errors.push(`${at}.category is required`);
    if (!isNonEmptyString(finding.evidence)) errors.push(`${at}.evidence is required`);
    if (!isNonEmptyString(finding.requiredCorrection)) {
      errors.push(`${at}.requiredCorrection is required`);
    }
    // `file` is optional — a finding may be about the change as a whole.
    if ("file" in finding && finding.file !== null && !isNonEmptyString(finding.file)) {
      errors.push(`${at}.file must be a non-empty string or null`);
    }
  });

  // A REVISE verdict with nothing to revise is not actionable.
  if (review.verdict === "REVISE" && review.findings.length === 0) {
    errors.push("REVISE requires at least one finding");
  }

  return { valid: errors.length === 0, errors };
}

/** Tier a permission belongs to, or "unknown". */
export function permissionTier(permission) {
  for (const [tier, permissions] of Object.entries(PERMISSION_TIERS)) {
    if (permissions.includes(permission)) return tier;
  }
  return "unknown";
}

/* ══ V2 orchestration vocabulary ═══════════════════════════════════════════ */
//
// V1 owns ONE Builder invocation. V2 owns a GOAL, and stays responsible for it
// across however many worker steps that goal survives. Everything below is the
// vocabulary that orchestration state is written in; the state itself lives
// outside the repository (agent/taskstate.mjs).

/**
 * Orchestration status of a goal.
 *
 * The point of having nine of these instead of "ok / failed" is that an
 * interruption is not an outcome. `paused` is resumable and expected;
 * `escalated` means the agent stopped because continuing would be guessing;
 * `failed` means the orchestration itself broke. ATLAS-004 was recorded as a
 * failure when it was a `paused`, and that misclassification is what threw away
 * a good implementation.
 */
export const ORCHESTRATION_STATUSES = [
  "pending",
  "investigating",
  "implementing",
  "validating",
  "waiting_for_approval",
  "paused",
  "escalated",
  "completed",
  "failed",
];

/** Statuses at which the orchestrator stops and hands back to a human. */
export const STOPPED_STATUSES = [
  "waiting_for_approval",
  "paused",
  "escalated",
  "completed",
  "failed",
];

/** A goal is only `completed` when every criterion is proven. */
export const CRITERION_STATUSES = [
  "pending",
  "verified",
  "failed",
  // Cannot be proven by this agent — a human must look. Never "assumed passed".
  "manual_verification_required",
];

/** Known workers. The orchestrator owns the goal; workers own capabilities. */
export const WORKERS = ["repo", "codex", "n8n", "vercel"];

/**
 * How a worker step ended. Structured, so the router never has to read prose.
 *
 * - `success`         — the action did what it said, evidence attached.
 * - `blocked`         — a real boundary is in the way. Carries a blocker.
 * - `paused`          — resumable interruption (usage limit, auth, budget).
 * - `requires_approval` — the action is Class B/C. NOT performed.
 * - `not_available`   — no connector wired. Never pretend it succeeded.
 * - `not_permitted`   — the worker has no such capability, or the task did not
 *                       grant its permission. A safety stop, not a retry.
 * - `failed`          — the worker itself broke.
 */
export const WORKER_RESULT_STATUSES = [
  "success",
  "blocked",
  "paused",
  "requires_approval",
  "not_available",
  "not_permitted",
  "failed",
];

/**
 * Action classes. A is performed automatically; B and C are queued for a human
 * and never executed by the orchestrator.
 *
 *   A — read-only or isolated (inspect, test, typecheck, edit a worktree)
 *   B — change-set approval  (commit, push, publish an n8n draft, non-secret config)
 *   C — high-risk approval   (production deploy, env/secret change, schema
 *                             migration, deletion, customer message, payment)
 */
export const ACTION_CLASSES = ["A", "B", "C"];

export const ACTION_CLASS_LABELS = {
  A: "automatic (read-only or isolated)",
  B: "change-set approval required",
  C: "high-risk explicit approval required",
};

/** Permission tier → action class. Anything unrecognised is treated as C. */
export const TIER_ACTION_CLASS = { automatic: "A", approval: "B", critical: "C" };

/**
 * Action class of a worker capability.
 *
 * A capability may name an explicit `actionClass` (for external actions that
 * have no entry in the task permission vocabulary) or a `permission` from that
 * vocabulary. If it names neither, or names something unknown, the answer is C:
 * "if unsure, require approval" is a rule, not an aspiration.
 */
export function actionClassOf(capability) {
  if (capability?.actionClass && ACTION_CLASSES.includes(capability.actionClass)) {
    return capability.actionClass;
  }
  return TIER_ACTION_CLASS[permissionTier(capability?.permission)] ?? "C";
}

/**
 * Progress budget. Bounded, never infinite; generous enough that a real
 * multi-system debugging session is not cut off after two revisions.
 */
export const DEFAULT_BUDGET = {
  maxTotalSteps: 30,
  maxSameFailureWithoutNewEvidence: 2,
  maxPerWorkerAttempts: 5,
};

const TASK_STATE_FIELDS = [
  "taskId",
  "goal",
  "status",
  "successCriteria",
  "verifiedBoundaries",
  "currentBlocker",
  "activeWorker",
  "attempts",
  "evidence",
  "nextAction",
  "approvalsPending",
  "lastProgressAt",
  "stopReason",
  "createdAt",
  "updatedAt",
];

/**
 * Validate orchestration state. Same contract as every other validator here:
 * collect readable errors, never throw.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTaskState(state) {
  const errors = [];
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return { valid: false, errors: ["task state must be an object"] };
  }

  for (const field of TASK_STATE_FIELDS) {
    if (!(field in state)) errors.push(`task state is missing ${field}`);
  }

  for (const field of ["taskId", "goal", "createdAt", "updatedAt"]) {
    if (field in state && !isNonEmptyString(state[field])) {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  if ("status" in state && !ORCHESTRATION_STATUSES.includes(state.status)) {
    errors.push(`status must be one of: ${ORCHESTRATION_STATUSES.join(", ")}`);
  }

  for (const field of ["verifiedBoundaries", "evidence", "approvalsPending", "successCriteria"]) {
    if (field in state && !Array.isArray(state[field])) errors.push(`${field} must be an array`);
  }

  if (
    "activeWorker" in state &&
    state.activeWorker !== null &&
    !WORKERS.includes(state.activeWorker)
  ) {
    errors.push(`activeWorker must be null or one of: ${WORKERS.join(", ")}`);
  }

  (Array.isArray(state.successCriteria) ? state.successCriteria : []).forEach(
    (criterion, index) => {
      const at = `successCriteria[${index}]`;
      if (criterion === null || typeof criterion !== "object") {
        errors.push(`${at} must be an object`);
        return;
      }
      if (!isNonEmptyString(criterion.id)) errors.push(`${at}.id must be a non-empty string`);
      if (!isNonEmptyString(criterion.text)) errors.push(`${at}.text must be a non-empty string`);
      if (!CRITERION_STATUSES.includes(criterion.status)) {
        errors.push(`${at}.status must be one of: ${CRITERION_STATUSES.join(", ")}`);
      }
    },
  );

  if ("attempts" in state) {
    const attempts = state.attempts;
    if (attempts === null || typeof attempts !== "object") {
      errors.push("attempts must be an object");
    } else if (!Number.isInteger(attempts.total)) {
      errors.push("attempts.total must be an integer");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a worker result. The router reads these instead of prose, so a
 * malformed one must be caught at the boundary rather than routed on.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateWorkerResult(result) {
  const errors = [];
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return { valid: false, errors: ["worker result must be an object"] };
  }
  if (!WORKERS.includes(result.worker)) {
    errors.push(`worker must be one of: ${WORKERS.join(", ")}`);
  }
  if (!isNonEmptyString(result.action)) errors.push("action must be a non-empty string");
  if (!WORKER_RESULT_STATUSES.includes(result.status)) {
    errors.push(`status must be one of: ${WORKER_RESULT_STATUSES.join(", ")}`);
  }
  if (typeof result.changed !== "boolean") errors.push("changed must be a boolean");
  if (!Array.isArray(result.evidence)) errors.push("evidence must be an array");
  if (!Array.isArray(result.verifiedBoundariesAdded)) {
    errors.push("verifiedBoundariesAdded must be an array");
  }
  if (result.blocker !== null && typeof result.blocker !== "object") {
    errors.push("blocker must be null or an object");
  }
  if (result.blocker && !isNonEmptyString(result.blocker.boundary)) {
    errors.push("blocker.boundary must be a non-empty string");
  }
  // A blocked result with no fingerprint cannot be compared against the next
  // one, which is how "the same failure twice" would go undetected forever.
  if (result.status === "blocked" && !isNonEmptyString(result.failureFingerprint)) {
    errors.push("a blocked result must carry a failureFingerprint");
  }
  return { valid: errors.length === 0, errors };
}
