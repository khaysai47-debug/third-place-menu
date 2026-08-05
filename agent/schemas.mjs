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
 */
export const PAUSE_STATES = [
  "PAUSED_USAGE_LIMIT",
  "PAUSED_AUTH_REQUIRED",
  "PAUSED_NETWORK_ERROR",
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
  "usage_limit",
  "auth_failure",
  "network_failure",
  "malformed_output",
  "timeout",
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
