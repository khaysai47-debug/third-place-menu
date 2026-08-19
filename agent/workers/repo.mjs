// Repo worker: everything that happens inside this repository.
//
// It does not reimplement V1 — it IS V1, wrapped in the worker contract. The
// isolated worktree, the shell-less Builder, the scope gate, the baseline-aware
// checks, the read-only Reviewer and the preserved diff are all the engine's,
// unchanged. What this file adds is a structured answer the router can act on,
// and one behaviour V1 lacked: an interrupted Builder is RESUMED in its own
// worktree instead of being thrown away (ATLAS-004).
//
// It has no capability that touches n8n, Vercel, Supabase or Meta. Not by
// policy — there is no such function on this object.
import { executionPreflight, liveGitAt } from "../coordinator.mjs";
import { resumeRun, runTask } from "../engine.mjs";
import { resumePrompt } from "../prompts.mjs";
import {
  BOUNDARIES,
  blocked,
  evidence,
  failed,
  guard,
  notPermitted,
  ok,
  paused,
  requiresApproval,
} from "./contract.mjs";

export const CAPABILITIES = {
  inspect: {
    permission: "read_repository",
    summary: "read-only preflight: task, approval, HEAD, tree, worktree state",
  },
  implement: {
    permission: "edit_task_workspace",
    summary: "create the isolated worktree and run Builder → checks → Reviewer",
  },
  resume_implement: {
    permission: "edit_task_workspace",
    summary: "continue an interrupted implementation in the SAME worktree",
  },
  commit: {
    permission: "commit",
    summary: "commit the worktree (Class B — the orchestrator never performs it)",
  },
};

/** Preflight statuses that mean "a human must approve something". */
const APPROVAL_STATUSES = new Set([
  "READY_FOR_APPROVAL",
  "APPROVAL_MISSING",
  "APPROVAL_STALE",
  "APPROVAL_INVALID",
]);

/** Preflight statuses a retry cannot fix — the repository itself must change. */
const HUMAN_FIX_STATUSES = new Set([
  "INVALID_TASK",
  "BASE_COMMIT_MISMATCH",
  "DIRTY_REPOSITORY",
  "WORKTREE_CONFLICT",
  "BRANCH_EXISTS",
]);

/**
 * Engine run states this worker may attempt again with a fresh Builder round.
 * Everything else is either finished, waiting on a human, or a boundary breach.
 */
const RETRYABLE_RUN_STATES = new Set(["CHECKS_FAILED", "NEEDS_HUMAN"]);

const firstFailure = (run) => {
  const failing = (run.checkResults ?? []).find((c) => c.result === "NEW_FAILURE");
  if (!failing) return null;
  const first = failing.newFailures?.[0];
  return `${failing.name}: ${first ? `${first.file}${first.line ? `:${first.line}` : ""} ${first.message}` : "new failure"}`;
};

/** Evidence for one engine run: what changed, what the checks said, what the reviewer said. */
function runEvidence(run, action) {
  const entries = [
    evidence({
      worker: "repo",
      action,
      kind: "diff",
      summary: `${run.filesChanged?.length ?? 0} file(s) changed: ${(run.filesChanged ?? []).join(", ") || "none"}`,
      ref: run.worktree ?? null,
      payload: { runId: run.runId, branch: run.branch, filesChanged: run.filesChanged ?? [] },
    }),
  ];
  for (const check of run.checkResults ?? []) {
    entries.push(
      evidence({
        worker: "repo",
        action,
        kind: "check",
        summary: `${check.name}: ${check.result}${
          check.result === "NEW_FAILURE" ? ` — ${check.newFailures?.[0]?.message ?? "failed"}` : ""
        }`,
        payload: { name: check.name, result: check.result, newFailures: check.newFailures ?? [] },
      }),
    );
  }
  if (run.reviewVerdict) {
    entries.push(
      evidence({
        worker: "repo",
        action,
        kind: "review",
        summary: `codex ${run.reviewVerdict} with ${(run.findings ?? []).length} finding(s): ${(
          run.findings ?? []
        )
          .map((f) => f.id)
          .join(", ")}`,
        payload: { verdict: run.reviewVerdict, findings: run.findings ?? [] },
      }),
    );
  }
  return entries;
}

/** Boundaries an engine run PROVED. Only what actually ran counts. */
function verifiedFrom(run) {
  const proven = [];
  if (["PASS", "READY_FOR_HUMAN_REVIEW"].includes(run.state)) {
    proven.push(BOUNDARIES.repoImplementation);
  }
  const checks = run.checkResults ?? [];
  if (checks.length > 0 && checks.every((c) => c.result !== "NEW_FAILURE")) {
    proven.push(BOUNDARIES.repoChecks);
    for (const check of checks) proven.push(`${BOUNDARIES.repoChecks}.${check.name}`);
  }
  if (run.reviewVerdict === "PASS") proven.push(BOUNDARIES.review);
  return proven;
}

/** Map an engine run onto the worker contract. The whole V1→V2 translation. */
export function resultFromRun(run, action) {
  const common = {
    evidence: runEvidence(run, action),
    verifiedBoundariesAdded: verifiedFrom(run),
    changed: (run.filesChanged?.length ?? 0) > 0,
    data: {
      runId: run.runId,
      branch: run.branch,
      worktree: run.worktree,
      state: run.state,
      filesChanged: run.filesChanged ?? [],
      reviewVerdict: run.reviewVerdict ?? null,
      findings: run.findings ?? [],
      retryable: RETRYABLE_RUN_STATES.has(run.state),
    },
  };

  switch (run.state) {
    case "PASS":
    case "READY_FOR_HUMAN_REVIEW":
      return ok("repo", action, { ...common, suggestedNextWorker: null });

    // The ATLAS-004 case. Work exists, the clock ran out. Resume, do not restart.
    case "PAUSED_BUILDER_BUDGET":
      return blocked(
        "repo",
        action,
        {
          boundary: BOUNDARIES.repoImplementation,
          kind: "builder_budget_exhausted",
          detail: `Builder turn budget spent with ${run.filesChanged?.length ?? 0} file(s) already changed in ${run.worktree}`,
        },
        { ...common, resumable: true, suggestedNextWorker: "repo" },
      );

    case "PAUSED_USAGE_LIMIT":
    case "PAUSED_AUTH_REQUIRED":
    case "PAUSED_NETWORK_ERROR":
    case "RESUME_SCHEDULED":
      return paused(
        "repo",
        action,
        {
          boundary: BOUNDARIES.repoImplementation,
          kind: run.pauseReason ?? "interrupted",
          detail: `${run.state}${run.expectedRetryAt ? ` — retry expected at ${run.expectedRetryAt}` : ""}`,
        },
        common,
      );

    case "CHECKS_FAILED":
      return blocked(
        "repo",
        action,
        {
          boundary: BOUNDARIES.repoChecks,
          kind: "check_failure",
          detail: firstFailure(run) ?? "a required check ended in NEW_FAILURE",
        },
        { ...common, resumable: true },
      );

    // A boundary breach, never a quality problem to iterate on. AGENTS.md.
    case "SCOPE_VIOLATION":
      return blocked(
        "repo",
        action,
        {
          boundary: BOUNDARIES.repoScope,
          kind: "scope_violation",
          detail: `the Builder wrote outside the task's scope: ${(run.notes ?? [])
            .filter((n) => n.startsWith("scope violation"))
            .join("; ")}`,
        },
        { ...common, terminal: true },
      );

    case "NEEDS_HUMAN": {
      // A reviewer that escalated, or output nobody could read, is the end of
      // the line. A spent revision budget with actionable findings is not.
      const reviewerEscalated =
        run.reviewVerdict === "NEEDS_HUMAN" ||
        run.errorCategory === "reviewer" ||
        !run.reviewVerdict;
      return blocked(
        "repo",
        action,
        {
          boundary: reviewerEscalated ? BOUNDARIES.review : "review.findings",
          kind: reviewerEscalated ? "needs_human" : "revision_budget_exhausted",
          detail: (run.notes ?? []).slice(-1)[0] ?? "the run stopped for a human",
        },
        { ...common, terminal: reviewerEscalated, resumable: !reviewerEscalated },
      );
    }

    case "BLOCKED_PERMISSION":
      return notPermitted(
        "repo",
        action,
        `task ${run.taskId} requests a protected action; a human performs those`,
        common,
      );

    default:
      break;
  }

  if (APPROVAL_STATUSES.has(run.state)) {
    const result = requiresApproval("repo", action, {
      actionClass: "B",
      reason: `the task has no valid approval receipt (${run.state})`,
      detail: `npm run agent:approve -- --task <task.json> --by "Your Name"`,
      ...common,
    });
    // What needs approving is the TASK, not the inspection that discovered it.
    result.requiresApproval.action = "task_approval";
    return result;
  }
  if (HUMAN_FIX_STATUSES.has(run.state)) {
    return blocked(
      "repo",
      action,
      {
        boundary: BOUNDARIES.repoPreflight,
        kind: run.state.toLowerCase(),
        detail: (run.notes ?? []).slice(-1)[0] ?? run.state,
      },
      { ...common, terminal: true },
    );
  }
  return failed(
    "repo",
    action,
    `${run.state}: ${run.errorMessage ?? "engine reported a failure"}`,
    common,
  );
}

/* ── The worker ──────────────────────────────────────────────────────────── */

/**
 * @param {object} deps
 * @param {object} deps.engine      { runTask, resumeRun } — injected for tests
 * @param {Function} deps.preflight executionPreflight, injected for tests
 * @param {object} deps.engineOptions passed straight through to the engine
 */
export function createRepoWorker({
  engine = { runTask, resumeRun },
  preflight = executionPreflight,
  engineOptions = {},
} = {}) {
  return {
    name: "repo",
    capabilities: CAPABILITIES,

    async act({ action, task, taskFile, state }) {
      const refusal = guard({ worker: "repo", action, task, capabilities: CAPABILITIES });
      if (refusal) return refusal;

      const opts = {
        ...engineOptions,
        git:
          engineOptions.git ??
          (engineOptions.repoRoot ? liveGitAt(engineOptions.repoRoot) : undefined),
      };

      try {
        if (action === "inspect") return inspect({ preflight, taskFile, task, opts });

        if (action === "resume_implement") {
          const runId = state?.activeRun?.runId;
          if (!runId) {
            return failed("repo", action, "no run to resume — the goal has no active worktree");
          }
          const { run } = await engine.resumeRun(runId, {
            ...opts,
            continueAfterTerminal: true,
            prompt: resumePrompt({
              task,
              repoRoot: opts.repoRoot ?? process.cwd(),
              filesChanged: state.activeRun.filesChanged ?? [],
              blocker: state.currentBlocker,
              notes: resumeNotes(state),
            }),
          });
          return resultFromRun(run, action);
        }

        const { run } = await engine.runTask(taskFile, opts);
        return resultFromRun(run, action);
      } catch (error) {
        return failed("repo", action, String(error?.message ?? error).split("\n")[0]);
      }
    },
  };
}

/** What the orchestrator knows that the Builder does not. */
const resumeNotes = (state) => [
  ...(state.verifiedBoundaries.length
    ? [`Already proven, do not re-litigate: ${state.verifiedBoundaries.join(", ")}`]
    : []),
  ...(state.lessons ?? []).map((lesson) =>
    typeof lesson === "string" ? lesson : `${lesson.id}: ${lesson.lesson}`,
  ),
];

/** Read-only preflight. Touches nothing, authorizes nothing, proves one boundary. */
function inspect({ preflight, taskFile, task, opts }) {
  const result = preflight(taskFile, {
    ...(opts.git ? { git: opts.git } : {}),
    expectWorktree: null,
    stateDir: opts.stateDir,
    repoRoot: opts.repoRoot ?? process.cwd(),
  });

  const gateEvidence = evidence({
    worker: "repo",
    action: "inspect",
    kind: "preflight",
    summary: `preflight ${result.status}: ${(result.gates ?? [])
      .map((g) => `${g.name}=${g.ok ? "ok" : "FAIL"}`)
      .join(" ")}`,
    payload: { status: result.status, gates: result.gates ?? [] },
  });

  // Accepting control-plane drift is a decision, so it is written down. The
  // approved product base is repeated in the summary because that is the number
  // a human checks: the runtime moved, the baseline did not.
  const drift = result.controlPlaneDrift;
  const driftEvidence = drift
    ? [
        evidence({
          worker: "repo",
          action: "inspect",
          kind: "preflight",
          summary:
            `control-plane drift accepted: runtime advanced to ${drift.runtimeHead} over ` +
            `${drift.files.length} control-plane file(s) (${drift.files.slice(0, 5).join(", ")}); ` +
            `approved product base unchanged at ${drift.approvedProductBase}`,
          payload: drift,
        }),
      ]
    : [];

  if (result.status === "READY_TO_RUN") {
    return ok("repo", "inspect", {
      evidence: [gateEvidence, ...driftEvidence],
      verifiedBoundariesAdded: [BOUNDARIES.repoPreflight],
      data: {
        workspace: result.workspace,
        worktreeState: result.worktreeState,
        controlPlaneDrift: drift,
      },
    });
  }
  // Reuse the run mapping so a preflight refusal and a run refusal are reported
  // identically — the failing gate is the same object either way. The evidence
  // is the gates themselves, not an empty diff.
  const mapped = resultFromRun(
    {
      state: result.status,
      taskId: task?.taskId,
      notes: (result.gates ?? []).filter((g) => !g.ok).map((g) => `gate ${g.name}: ${g.detail}`),
      filesChanged: [],
      checkResults: [],
    },
    "inspect",
  );
  return { ...mapped, evidence: [gateEvidence] };
}
