// Prompts handed to the Builder and the Reviewer.
//
// Kept in one file so the instructions a model receives are reviewable in a
// single place. The prohibitions here are belt-and-braces: the CLI flags in
// adapters/ already make commit/push/deploy impossible. Stating them anyway
// means a model that somehow gains a shell still knows the rules.
import { readFileSync } from "node:fs";

const safeRead = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

const RULES = `HARD RULES — non-negotiable:
- Do NOT commit, push, create a branch, create a pull request, merge or deploy.
- Do NOT run git commands of any kind.
- Do NOT modify n8n, Supabase, Meta Messenger, Vercel configuration, secrets or
  environment values.
- Do NOT send a real customer message, or create a real order or payment.
- Do NOT print, echo or paste any secret, token or credential value.
- Do NOT touch any path outside the task's allowedPaths.
- Do NOT touch any path listed in the task's forbiddenPaths.
- Do NOT widen the task's scope. A problem you discover outside scope is
  reported in your summary as a note, never fixed here.
- You are working inside an isolated git worktree. Edit files only.`;

/** Project memory the models are allowed to see. Never .env, never secrets. */
export function projectMemory(repoRoot) {
  const join = (label, body) => (body.trim() ? `\n\n===== ${label} =====\n${body.trim()}` : "");
  return (
    join("AGENTS.md", safeRead(`${repoRoot}/AGENTS.md`)) +
    join("project/PERMISSIONS.md", safeRead(`${repoRoot}/project/PERMISSIONS.md`)) +
    join("project/TEST_MATRIX.md", safeRead(`${repoRoot}/project/TEST_MATRIX.md`))
  );
}

const taskBlock = (task) =>
  JSON.stringify(
    {
      taskId: task.taskId,
      title: task.title,
      objective: task.objective,
      context: task.context,
      riskLevel: task.riskLevel,
      baseCommit: task.baseCommit,
      allowedPaths: task.allowedPaths,
      forbiddenPaths: task.forbiddenPaths,
      acceptanceCriteria: task.acceptanceCriteria,
      stoppingRules: task.stoppingRules,
    },
    null,
    2,
  );

const REPORT_CONTRACT = `When you are done, end your reply with exactly one fenced JSON block:

\`\`\`json
{
  "summary": "one paragraph on what you changed and why",
  "filesChanged": ["relative/path/one.ts"],
  "notes": ["anything the human should know, including out-of-scope problems you did NOT fix"]
}
\`\`\`

The block is required. Without it your work is rejected as malformed output.`;

/** First implementation round. */
export function builderPrompt({ task, repoRoot }) {
  return `You are the Claude Builder for the Atlas Development Agent.

Implement this approved task inside the current working directory, which is an
isolated git worktree created for it.

===== TASK =====
${taskBlock(task)}

${RULES}
${projectMemory(repoRoot)}

${REPORT_CONTRACT}`;
}

/** Revision round: findings from checks and/or the Reviewer. */
export function revisionPrompt({ task, findings, checkFailures = [], round }) {
  const findingText = findings.length
    ? findings
        .map(
          (f) =>
            `- [${f.id}] (${f.severity}/${f.category})${f.file ? ` ${f.file}` : ""}\n` +
            `  evidence: ${f.evidence}\n  required: ${f.requiredCorrection}`,
        )
        .join("\n")
    : "- (none)";

  const checkText = checkFailures.length
    ? checkFailures
        .map((c) => `- ${c.name}: ${c.newFailures.length} new failure(s)\n${formatFailures(c)}`)
        .join("\n")
    : "- (none)";

  return `Revision round ${round} for task ${task.taskId}.

Your previous implementation was reviewed. Fix ONLY what is listed below.
Do not refactor anything else. Do not widen scope. The task is unchanged:

allowedPaths:   ${JSON.stringify(task.allowedPaths)}
forbiddenPaths: ${JSON.stringify(task.forbiddenPaths)}

===== FAILING CHECKS =====
${checkText}

===== REVIEWER FINDINGS =====
${findingText}

${RULES}

${REPORT_CONTRACT}`;
}

const formatFailures = (check) =>
  check.newFailures
    .slice(0, 20)
    .map((f) => `    ${f.file}${f.line ? `:${f.line}` : ""} ${f.rule ?? ""} ${f.message}`)
    .join("\n");

/** Independent review of the Builder's diff. */
export function reviewerPrompt({ task, changedFiles, diff, checkResults, builderSummary }) {
  const checkSummary = checkResults
    .map(
      (c) =>
        `- ${c.name}: ${c.result} (new: ${c.newFailures?.length ?? 0}, ` +
        `baseline: ${c.baselineFailures?.length ?? 0})`,
    )
    .join("\n");

  return `You are the independent Codex Reviewer for the Atlas Development Agent.

Review the diff below against the task's acceptance criteria. You are READ-ONLY:
do not edit any file, do not run git, do not commit, push or deploy. Judge what
the diff actually does, not what the summary claims it does.

===== TASK =====
${taskBlock(task)}

===== BASE COMMIT =====
${task.baseCommit}

===== BUILDER SUMMARY =====
${builderSummary ?? "(none)"}

===== CHANGED FILES =====
${changedFiles.length ? changedFiles.map((f) => `- ${f}`).join("\n") : "- (none)"}

===== CHECK RESULTS =====
${checkSummary || "- (none)"}

A BASELINE_FAILURE is pre-existing repository debt and is NOT this task's fault.
Do not raise findings about it. A NEW_FAILURE is this task's responsibility.

===== UNIFIED DIFF =====
${diff || "(empty diff)"}

Reply with exactly one fenced JSON block and nothing after it:

\`\`\`json
{
  "verdict": "PASS | REVISE | NEEDS_HUMAN",
  "summary": "one paragraph",
  "findings": [
    {
      "id": "F1",
      "severity": "blocker | major | minor",
      "category": "correctness | scope | security | accessibility | style | testing",
      "file": "relative/path.ts or null",
      "evidence": "what in the diff shows the problem",
      "requiredCorrection": "the specific change required"
    }
  ]
}
\`\`\`

Rules for your verdict:
- PASS: every acceptance criterion is met and you found no blocking problem.
  findings must be [] or contain only "minor" items.
- REVISE: fixable problems exist. Include at least one finding.
- NEEDS_HUMAN: the task itself is ambiguous, unsafe, or you cannot judge it.
Malformed output is rejected, so emit the block exactly as specified.`;
}
