// Claude Code Builder adapter.
//
// Invokes the installed `claude` CLI non-interactively inside the isolated
// worktree. The Builder owns implementation; the Coordinator never edits
// application code itself.
//
// SAFETY, enforced at the command line rather than by asking politely:
//   * --permission-mode acceptEdits  — file edits allowed, everything else
//     still needs permission, and in -p mode an unanswerable prompt is a DENY.
//   * --disallowedTools Bash,...     — no shell at all, so the Builder cannot
//     run git, cannot commit, cannot push, cannot deploy, cannot install.
//   * NEVER --dangerously-skip-permissions, NEVER bypassPermissions.
//   * cwd is the worktree, so even a file write cannot reach the main checkout.
import { spawnSync } from "node:child_process";

export const DEFAULTS = {
  maxTurns: 30,
  timeoutMs: 20 * 60 * 1000,
  // Tools the Builder must never have. Bash covers git/npm/curl in one stroke.
  disallowedTools: ["Bash", "WebFetch", "WebSearch", "NotebookEdit"],
};

const CLI = process.platform === "win32" ? "claude.cmd" : "claude";

/**
 * Build the argv for a Builder invocation. Pure, so tests can assert the exact
 * command without spawning anything.
 */
export function buildCommand({ prompt, sessionId = null, maxTurns, disallowedTools } = {}) {
  const args = [
    "--print",
    prompt ?? "",
    "--output-format",
    "json",
    "--max-turns",
    String(maxTurns ?? DEFAULTS.maxTurns),
    "--permission-mode",
    "acceptEdits",
    "--disallowedTools",
    (disallowedTools ?? DEFAULTS.disallowedTools).join(","),
  ];
  // Resuming keeps the Builder's reasoning context across a revision or a pause.
  if (sessionId) args.push("--resume", sessionId);
  return { command: CLI, args };
}

const UNSAFE_FLAGS = [
  "--dangerously-skip-permissions",
  "bypassPermissions",
  "--dangerously-allow-browser",
];

/** Guard: refuse to run a command that contains a permission-bypass flag. */
export function assertSafeCommand({ args }) {
  const joined = args.join(" ");
  for (const flag of UNSAFE_FLAGS) {
    if (joined.includes(flag)) throw new Error(`refusing unsafe Builder flag: ${flag}`);
  }
}

/* ── Failure classification ──────────────────────────────────────────────── */

const USAGE = /usage limit|rate.?limit|quota exceeded|too many requests|429/i;
const AUTH = /not logged in|unauthori[sz]ed|authentication|invalid api key|please run .*login|401/i;
const NETWORK =
  /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i;

/**
 * Claude prints "Claude AI usage limit reached|<unix-seconds>" when the plan
 * quota runs out. Recover the reset time so the resume can be scheduled at it
 * rather than guessed.
 */
export function parseResetAt(text = "") {
  const epoch = text.match(/usage limit reached\|(\d{9,13})/i);
  if (epoch) {
    const value = Number(epoch[1]);
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  const iso = text.match(/resets? (?:at|on)\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/i);
  return iso ? new Date(iso[1]).toISOString() : null;
}

/**
 * Classify a finished Builder process into one of BUILDER_OUTCOMES.
 * Pause-shaped failures are checked before generic failure, because a usage
 * limit that gets recorded as an implementation failure would burn a revision
 * round for something the Builder did not do wrong.
 */
export function classifyResult({ status, stdout = "", stderr = "", timedOut = false }) {
  const text = `${stdout}\n${stderr}`;

  if (timedOut) return { outcome: "timeout", detail: "Builder exceeded its timeout" };
  if (USAGE.test(text)) {
    return { outcome: "usage_limit", detail: "usage limit reached", resetAt: parseResetAt(text) };
  }
  if (AUTH.test(text)) return { outcome: "auth_failure", detail: "authentication required" };
  if (NETWORK.test(text)) return { outcome: "network_failure", detail: "network error" };

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return { outcome: "malformed_output", detail: "stdout was not valid JSON" };
  }

  if (payload?.is_error === true || payload?.subtype === "error_during_execution") {
    return {
      outcome: "implementation_failure",
      detail: payload.subtype ?? "builder reported an error",
      sessionId: payload.session_id ?? null,
    };
  }
  if (payload?.subtype === "error_max_turns") {
    return {
      outcome: "implementation_failure",
      detail: "builder hit its turn limit",
      sessionId: payload.session_id ?? null,
    };
  }
  if (status !== 0) {
    return { outcome: "implementation_failure", detail: `exit code ${status}` };
  }

  const report = parseBuilderReport(payload?.result ?? "");
  if (!report.ok) {
    return {
      outcome: "malformed_output",
      detail: report.error,
      sessionId: payload?.session_id ?? null,
      raw: payload?.result ?? "",
    };
  }

  return {
    outcome: "success",
    detail: "ok",
    sessionId: payload?.session_id ?? null,
    numTurns: payload?.num_turns ?? null,
    report: report.value,
  };
}

/**
 * The Builder is asked to end its reply with a fenced ```json block holding
 * { summary, filesChanged, notes }. Anything else is malformed — the engine
 * verifies the real file changes with Git regardless, so this block is a
 * statement of intent to compare against, not a source of truth.
 */
export function parseBuilderReport(text) {
  const fenced = [...String(text).matchAll(/```json\s*([\s\S]*?)```/gi)].at(-1);
  if (!fenced) return { ok: false, error: "no ```json report block in Builder output" };
  let value;
  try {
    value = JSON.parse(fenced[1]);
  } catch (error) {
    return { ok: false, error: `Builder report block is not valid JSON: ${error.message}` };
  }
  if (typeof value?.summary !== "string" || value.summary.trim() === "") {
    return { ok: false, error: "Builder report is missing a summary" };
  }
  if (!Array.isArray(value.filesChanged)) {
    return { ok: false, error: "Builder report is missing filesChanged[]" };
  }
  return { ok: true, value };
}

/* ── Invocation ──────────────────────────────────────────────────────────── */

/**
 * Run the Builder once. Returns a classified result; never throws for a model
 * failure, only for a refusal to construct an unsafe command.
 */
export function invokeBuilder({
  prompt,
  worktree,
  sessionId = null,
  maxTurns = DEFAULTS.maxTurns,
  timeoutMs = DEFAULTS.timeoutMs,
  disallowedTools = DEFAULTS.disallowedTools,
} = {}) {
  const { command, args } = buildCommand({ prompt, sessionId, maxTurns, disallowedTools });
  assertSafeCommand({ args });

  const started = Date.now();
  const proc = spawnSync(command, args, {
    cwd: worktree,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    // No shell: arguments are passed as an array, so a prompt can never be
    // reinterpreted as shell syntax.
    shell: false,
  });

  const timedOut = proc.error?.code === "ETIMEDOUT" || proc.signal === "SIGTERM";
  const classified = classifyResult({
    status: proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? (proc.error ? String(proc.error.message) : ""),
    timedOut,
  });

  return {
    ...classified,
    exitCode: proc.status ?? null,
    durationMs: Date.now() - started,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    command: `${command} ${args.join(" ")}`,
  };
}

/** The real adapter, in the shape the engine expects. */
export const claudeBuilder = {
  name: "claude-code",
  build: invokeBuilder,
};
