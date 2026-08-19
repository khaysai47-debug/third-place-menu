// One consolidated view of a goal, for a human who has better things to do than
// read agent transcripts.
//
// `statusBlock` is the "where are we" answer, printable at any moment.
// `finalReportMarkdown` is the "what happened" answer, written once when the
// goal stops. Both read only from persisted state, so they say the same thing
// tomorrow as they did when the loop stopped.
import { ACTION_CLASS_LABELS } from "./schemas.mjs";

const bullets = (items, empty = "(none)") =>
  items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;

const criterionLine = (criterion) => {
  const mark = {
    verified: "PASS",
    failed: "FAIL",
    manual_verification_required: "MANUAL",
    pending: "open",
  }[criterion.status];
  return `[${mark}] ${criterion.id} — ${criterion.text}${
    criterion.verifiedBy ? ` (proven by ${criterion.verifiedBy})` : " (no automatic verifier)"
  }`;
};

const lastStep = (state) => state.history?.[state.history.length - 1] ?? null;

/** The consolidated status block. Plain text; the CLI prints it verbatim. */
export function statusBlock(state) {
  const step = lastStep(state);
  const approvals = (state.approvalsPending ?? []).map(
    (a) =>
      `${a.worker}.${a.action} — Class ${a.actionClass} (${ACTION_CLASS_LABELS[a.actionClass]}): ${a.reason}` +
      (a.detail ? `\n  ${a.detail}` : ""),
  );

  return `TASK      ${state.taskId}
GOAL      ${state.goal}
STATUS    ${state.status}${state.stopReason ? ` (${state.stopReason})` : ""}
STEPS     ${state.attempts?.total ?? 0} of ${state.budget?.maxTotalSteps ?? "?"}

VERIFIED
${bullets(state.verifiedBoundaries ?? [], "nothing proven yet")}

SUCCESS CRITERIA
${bullets((state.successCriteria ?? []).map(criterionLine), "none declared")}

CURRENT BLOCKER
${
  state.currentBlocker
    ? `- ${state.currentBlocker.boundary} (${state.currentBlocker.kind}): ${state.currentBlocker.detail}`
    : "- (none)"
}

ACTIVE WORKER
- ${state.activeWorker ?? "(none)"}

LAST ACTION
${step ? `- ${step.worker}.${step.action} → ${step.status}: ${step.reason}` : "- (none yet)"}

NEXT ACTION
- ${state.nextAction ?? "(none)"}

APPROVALS REQUIRED
${bullets(approvals)}

WORKTREE
- ${state.activeRun?.worktree ?? "(none)"}${state.activeRun?.branch ? ` on ${state.activeRun.branch}` : ""}`;
}

/**
 * Distinct blockers this goal hit, and whether they were left behind.
 *
 * A blocker counts as resolved if the goal later verified its boundary or moved
 * on to a different one — which is as much as the state can honestly claim.
 */
export function rootCauses(state) {
  const seen = new Map();
  for (const step of state.history ?? []) {
    if (!step.blocker) continue;
    const key = step.fingerprint ?? `${step.blocker.boundary}|${step.blocker.kind}`;
    if (!seen.has(key)) {
      seen.set(key, { ...step.blocker, firstSeenAtStep: step.step, occurrences: 0 });
    }
    seen.get(key).occurrences += 1;
  }
  const current = state.currentBlocker;
  return [...seen.values()].map((blocker) => ({
    ...blocker,
    resolved: !current || current.boundary !== blocker.boundary || current.kind !== blocker.kind,
  }));
}

/** Systems this goal actually touched, derived from the workers that acted. */
export const systemsTouched = (state) => [
  ...new Set((state.history ?? []).map((step) => step.worker).filter(Boolean)),
];

export function finalReportMarkdown(state, { task = null, lessons = [] } = {}) {
  const causes = rootCauses(state);
  const checks = (state.evidence ?? []).filter((e) => e.kind === "check");
  const reviews = (state.evidence ?? []).filter((e) => e.kind === "review");
  const diffs = (state.evidence ?? []).filter((e) => e.kind === "diff");
  const manual = (state.successCriteria ?? []).filter(
    (c) =>
      c.status === "manual_verification_required" || (!c.verifiedBy && c.status !== "verified"),
  );

  return `# ${state.taskId} — final report

| Field | Value |
| --- | --- |
| Goal | ${state.goal} |
| **Final status** | **${state.status}**${state.stopReason ? ` (${state.stopReason})` : ""} |
| Steps taken | ${state.attempts?.total ?? 0} of ${state.budget?.maxTotalSteps ?? "?"} |
| Workers used | ${systemsTouched(state).join(", ") || "(none)"} |
| Branch | ${state.activeRun?.branch ?? "(none)"} |
| Worktree | ${state.activeRun?.worktree ?? "(none)"} |
| Started | ${state.createdAt} |
| Last progress | ${state.lastProgressAt} |
| Ended | ${state.updatedAt} |

## 1. Original goal

${state.goal}

${task?.objective && task.objective !== state.goal ? `Task objective: ${task.objective}\n` : ""}
## 2. Root cause(s)

${bullets(
  causes.map(
    (c) =>
      `${c.resolved ? "resolved" : "OPEN"} — \`${c.boundary}\` (${c.kind}), seen ${c.occurrences}×: ${c.detail}`,
  ),
  "no blocker was ever hit",
)}

## 3. Changes made

${bullets(
  diffs.map((d) => d.summary),
  "nothing was changed",
)}

Nothing was committed, pushed, merged or deployed by the agent.

## 4. Systems touched

${bullets(systemsTouched(state))}

## 5. Validation

${bullets(
  checks.map((c) => c.summary),
  "no checks ran",
)}

## 6. Reviewer result

${bullets(
  reviews.map((r) => r.summary),
  "no independent review ran",
)}

## 7. Production actions

${bullets(
  (state.approvalsPending ?? []).map(
    (a) => `NOT PERFORMED — ${a.worker}.${a.action} (Class ${a.actionClass}): ${a.reason}`,
  ),
  "none — no production action was performed or attempted",
)}

## 8. Success criteria

${bullets((state.successCriteria ?? []).map(criterionLine), "none declared")}

## 9. Evidence

${bullets(
  (state.evidence ?? []).map(
    (e) => `\`${e.id}\` ${e.at} ${e.worker}.${e.action} [${e.kind}] ${e.summary}`,
  ),
  "no evidence recorded",
)}

## 10. Lessons applied

${bullets(
  (lessons ?? []).map((l) => (typeof l === "string" ? l : `${l.id}: ${l.lesson}`)),
  "none loaded",
)}

## 11. Unresolved limitations

${bullets(
  [
    ...causes
      .filter((c) => !c.resolved)
      .map((c) => `open blocker at \`${c.boundary}\`: ${c.detail}`),
    ...manual.map((c) => `${c.id} needs human verification: ${c.text}`),
    ...(state.status === "escalated" ? [`escalated: ${state.stopReason}`] : []),
  ],
  "none recorded",
)}

## 12. Next action

${state.nextAction ?? "(none)"}

---

_Orchestration state: this file's directory. Nothing in this report contains a
secret value; evidence payloads are scrubbed on write._
`;
}
