// Codex Reviewer worker: independent, read-only judgement.
//
// The reviewer is the one worker that must never be able to fix what it finds.
// That is enforced where it can be enforced — `--sandbox read-only` in
// adapters/codex.mjs, checked by assertSafeCommand — not by asking a model to
// behave. This worker adds only the review POLICY: which changes are meaningful
// enough to be worth an independent pass, and which are not.
import { codexReviewer } from "../adapters/codex.mjs";
import { reviewerPrompt } from "../prompts.mjs";
import { changedFiles as realChangedFiles, diffPatch as realDiffPatch } from "../workspace.mjs";
import { BOUNDARIES, blocked, evidence, failed, guard, ok, paused } from "./contract.mjs";

export const CAPABILITIES = {
  review: {
    permission: "review_local_diff",
    summary: "read-only independent review of the worktree diff",
  },
};

/**
 * When a repository change is worth an independent review.
 *
 * Configurable rather than hardcoded, because "meaningful" is a project
 * judgement: a contract change in `api/` always is, a typo in `docs/` never is,
 * and burning a Codex pass on the second is how a reviewer becomes noise that
 * people learn to skip.
 */
export const DEFAULT_REVIEW_POLICY = {
  // Always reviewed, whatever else matches: contracts, auth, money, the agent.
  alwaysReviewPaths: ["api/", "src/lib/", "supabase/", "agent/", "vercel.json", "AGENTS.md"],
  // Code, in general.
  reviewExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"],
  // Prose and stored artefacts. Reviewed only if something else pulls them in.
  trivialPaths: ["docs/", "project/"],
  trivialExtensions: [".md", ".txt", ".json", ".yml", ".yaml"],
};

const matches = (file, prefix) =>
  file === prefix || file.startsWith(prefix.replace(/\/+$/, "") + "/");
const extensionOf = (file) => file.slice(file.lastIndexOf("."));

/**
 * Does this change need an independent review?
 *
 * @returns {{ required: boolean, reason: string }}
 */
export function reviewRequired({ filesChanged = [], task = {}, policy = null }) {
  // Precedence: built-in default < the task's own policy < an explicit override.
  // `policy` must NOT default to DEFAULT_REVIEW_POLICY, or the default would be
  // spread last and silently outrank the task's declared policy.
  const active = { ...DEFAULT_REVIEW_POLICY, ...(task.reviewPolicy ?? {}), ...(policy ?? {}) };
  if (filesChanged.length === 0) return { required: false, reason: "nothing changed" };

  const always = filesChanged.filter((f) => active.alwaysReviewPaths.some((p) => matches(f, p)));
  if (always.length > 0) {
    return { required: true, reason: `sensitive path(s) changed: ${always.join(", ")}` };
  }

  const code = filesChanged.filter(
    (f) =>
      active.reviewExtensions.includes(extensionOf(f)) &&
      !active.trivialPaths.some((p) => matches(f, p)),
  );
  if (code.length > 0) {
    return { required: true, reason: `code changed: ${code.join(", ")}` };
  }

  return {
    required: false,
    reason: `only non-code paths changed: ${filesChanged.join(", ")}`,
  };
}

/** Map a reviewer adapter result onto the worker contract. */
export function resultFromReview(result, { filesChanged = [] } = {}) {
  const action = "review";

  if (
    result.outcome === "usage_limit" ||
    result.outcome === "auth_failure" ||
    result.outcome === "network_failure"
  ) {
    return paused("codex", action, {
      boundary: BOUNDARIES.review,
      kind: result.outcome,
      detail: result.error ?? result.outcome,
    });
  }
  // An unreadable review is never a PASS. V1's rule, kept exactly.
  if (result.outcome === "malformed_output") {
    return blocked(
      "codex",
      action,
      {
        boundary: BOUNDARIES.review,
        kind: "malformed_review",
        detail: result.error ?? "unparseable",
      },
      { terminal: true },
    );
  }
  if (result.outcome !== "success") {
    return failed("codex", action, `${result.outcome}: ${result.error ?? "reviewer failed"}`);
  }

  const review = result.review;
  const findings = review.findings ?? [];
  const reviewEvidence = [
    evidence({
      worker: "codex",
      action,
      kind: "review",
      summary: `codex ${review.verdict} over ${filesChanged.length} file(s) with ${findings.length} finding(s): ${findings
        .map((f) => `${f.id}/${f.severity}`)
        .join(", ")}`,
      payload: { verdict: review.verdict, summary: review.summary, findings },
    }),
  ];

  if (review.verdict === "PASS") {
    return ok("codex", action, {
      evidence: reviewEvidence,
      verifiedBoundariesAdded: [BOUNDARIES.review],
      data: { verdict: "PASS", findings },
    });
  }
  if (review.verdict === "NEEDS_HUMAN") {
    return blocked(
      "codex",
      action,
      {
        boundary: BOUNDARIES.review,
        kind: "needs_human",
        detail: review.summary ?? "the reviewer escalated to a human",
      },
      { terminal: true, evidence: reviewEvidence, data: { verdict: "NEEDS_HUMAN", findings } },
    );
  }

  // REVISE: actionable, and the implementer fixes it — not the reviewer.
  return blocked(
    "codex",
    action,
    {
      boundary: "review.findings",
      kind: "revision_requested",
      detail: findings.map((f) => `${f.id}/${f.severity}: ${f.requiredCorrection}`).join(" | "),
    },
    {
      evidence: reviewEvidence,
      suggestedNextWorker: "repo",
      data: { verdict: "REVISE", findings },
    },
  );
}

/**
 * @param {object} deps
 * @param {object} deps.reviewer  { review } — the read-only Codex adapter
 */
export function createCodexWorker({
  reviewer = codexReviewer,
  diffPatch = realDiffPatch,
  changedFiles = realChangedFiles,
  policy = DEFAULT_REVIEW_POLICY,
} = {}) {
  return {
    name: "codex",
    capabilities: CAPABILITIES,
    policy,

    async act({ action, task, state }) {
      const refusal = guard({ worker: "codex", action, task, capabilities: CAPABILITIES });
      if (refusal) return refusal;

      const worktree = state?.activeRun?.worktree;
      if (!worktree) {
        return failed("codex", action, "there is no worktree to review");
      }

      try {
        const files = changedFiles(worktree);
        const diff = diffPatch(worktree);
        const result = await reviewer.review({
          prompt: reviewerPrompt({
            task,
            changedFiles: files,
            diff,
            checkResults: state.activeRun.checkResults ?? [],
            builderSummary: state.activeRun.summary ?? null,
          }),
          worktree,
        });
        return resultFromReview(result, { filesChanged: files });
      } catch (error) {
        return failed("codex", action, String(error?.message ?? error).split("\n")[0]);
      }
    },
  };
}
