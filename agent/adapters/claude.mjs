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
//
// THE PROMPT TRAVELS ON STDIN, NEVER IN ARGV.
//
//   A live ATLAS-002 run died with ENAMETOOLONG before implementation started.
//   Windows caps a process command line at 32,767 UTF-16 units INCLUDING the
//   executable path, the flags, and the backslash/quote escaping libuv adds.
//   Measured: ATLAS-001's prompt (31,514 chars) built a 31,950-char command
//   line and fit with 817 to spare; ATLAS-002's (32,538) built 32,928 and
//   overflowed by 161. The prompt embeds AGENTS.md plus the task, so it only
//   grows — argv was never a viable transport for it.
//
//   `claude --print` with NO prompt positional reads the prompt from stdin
//   (verified against claude 2.1.228). So argv now carries flags only, and the
//   prompt goes through spawnSync's `input` as a UTF-8 Buffer: no shell, no
//   quoting, no interpreter, and no length limit worth caring about.
//
//   assertSafeCommand is STRICTER as a result, not looser — it now refuses any
//   positional argument at all, so a prompt cannot leak back into argv without
//   the guard stopping the run.
import {
  AdapterConfigurationError,
  flagNames,
  parseArgv,
  redactCommand,
  spawnCli,
  spawnFailure,
} from "./argv.mjs";

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
 *
 * It takes NO prompt — deliberately. The prompt is stdin's job (see the header),
 * and a `buildCommand` that cannot accept one is a `buildCommand` that cannot
 * put 32 KB back on the command line by accident.
 */
export function buildCommand({ sessionId = null, maxTurns, disallowedTools } = {}) {
  const args = [
    // Boolean here: with no prompt positional, --print makes the CLI read the
    // prompt from stdin. That is the whole transport change.
    "--print",
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
  if (sessionId) {
    // A session id is an opaque identifier, never a place to smuggle a flag.
    // It must START alphanumeric: "-" is legal inside a uuid but a leading dash
    // would make the value look like a flag to anything that reads argv.
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(String(sessionId))) {
      throw new AdapterConfigurationError(`refusing malformed session id: ${typeof sessionId}`);
    }
    args.push("--resume", String(sessionId));
  }
  return { command: CLI, args };
}

/**
 * Flags whose NEXT argv token is their value.
 *
 * `--print`/`-p` are DELIBERATELY NOT HERE. They used to be, because the prompt
 * followed `--print` and listing them kept 31 KB of prompt text out of the flag
 * namespace. The prompt is on stdin now, so `--print` is what it actually is to
 * the CLI: a boolean. Leaving it in this set would make parseArgv swallow
 * `--output-format` as its value — the guard would then see no output format, no
 * `--output-format` flag, and the wrong shape entirely.
 *
 * Nothing is weakened by the removal: the prompt is no longer an argv token, and
 * assertSafeCommand now refuses positionals outright.
 */
export const VALUE_FLAGS = new Set([
  "--output-format",
  "--input-format",
  "--max-turns",
  "--permission-mode",
  "--disallowedTools",
  "--allowedTools",
  "--resume",
  "--session-id",
  "--model",
  "--fallback-model",
  "--add-dir",
  "--append-system-prompt",
  "--system-prompt",
  "--settings",
  "--mcp-config",
  "--permission-prompt-tool",
]);

/** Flags that must never appear as an actual argv FLAG token. */
export const UNSAFE_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--dangerously-allow-browser",
  "--no-sandbox",
  "--yolo",
]);

/** Permission modes that remove the guardrails. */
export const DANGEROUS_PERMISSION_MODES = new Set([
  "bypassPermissions",
  "dangerouslySkipPermissions",
  "yolo",
]);

/** The only permission modes the Builder may run under. */
export const SAFE_PERMISSION_MODES = new Set(["default", "acceptEdits", "plan"]);

/** Tools the Builder must always be denied. Bash covers git, npm and curl. */
export const REQUIRED_DISALLOWED_TOOLS = ["Bash", "WebFetch", "WebSearch", "NotebookEdit"];

/**
 * Guard: refuse an unsafe Builder command.
 *
 * Inspects only real argv FLAGS and their configuration values. Prompt text is
 * never examined, because prompt text is never IN argv — it arrives on stdin. A
 * prompt that discusses `--dangerously-skip-permissions` (as AGENTS.md does) is
 * documentation, not configuration, and cannot reach this function at all.
 *
 * @throws {AdapterConfigurationError}
 */
export function assertSafeCommand({ args }) {
  const parsed = parseArgv(args, VALUE_FLAGS);
  const refuse = (message) => {
    throw new AdapterConfigurationError(message);
  };

  // The Builder argv is flags ONLY. A positional here means something that
  // belongs on stdin — almost certainly the prompt — has been put back on the
  // command line, which is what produced the ENAMETOOLONG run. Refuse it at the
  // boundary rather than letting Windows discover it 32 KB later. Never report
  // the token itself: a leaked prompt must not be echoed into a run record.
  if (parsed.positional.length > 0) {
    refuse(
      `Builder argv must carry flags only, got ${parsed.positional.length} positional ` +
        "argument(s) — the prompt belongs on stdin",
    );
  }

  for (const flag of flagNames(parsed)) {
    if (UNSAFE_FLAGS.has(flag)) refuse(`refusing unsafe Builder flag: ${flag}`);
  }

  // Non-interactive, or a permission prompt would hang forever.
  if (!parsed.flags.has("--print") && !parsed.flags.has("-p")) {
    refuse("Builder must run non-interactively (--print)");
  }

  const mode = parsed.flags.get("--permission-mode");
  if (typeof mode !== "string") refuse("Builder must set an explicit --permission-mode");
  if (DANGEROUS_PERMISSION_MODES.has(mode)) refuse(`refusing dangerous permission mode: ${mode}`);
  if (!SAFE_PERMISSION_MODES.has(mode)) refuse(`refusing unknown permission mode: ${mode}`);

  const disallowed = String(parsed.flags.get("--disallowedTools") ?? "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  for (const tool of REQUIRED_DISALLOWED_TOOLS) {
    if (!disallowed.includes(tool)) refuse(`Builder must disallow the ${tool} tool`);
  }

  // An explicit allow-list must never hand back what the deny-list removed.
  const allowed = String(parsed.flags.get("--allowedTools") ?? "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  for (const tool of allowed) {
    if (
      REQUIRED_DISALLOWED_TOOLS.some((denied) => tool === denied || tool.startsWith(`${denied}(`))
    ) {
      refuse(`refusing to re-allow the ${tool} tool`);
    }
  }

  return parsed;
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
export function classifyResult({
  status,
  stdout = "",
  stderr = "",
  timedOut = false,
  spawnError = null,
}) {
  const text = `${stdout}\n${stderr}`;

  if (timedOut) return { outcome: "timeout", detail: "Builder exceeded its timeout" };
  // A process that never started produces no stdout. Falling through to the
  // JSON parse below would report that silence as malformed model output and
  // blame the Builder for a runner fault. Checked before anything reads stdout.
  if (spawnError) {
    return {
      outcome: "process_spawn_error",
      category: spawnError.category,
      detail: spawnError.detail,
    };
  }
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
  const { command, args } = buildCommand({ sessionId, maxTurns, disallowedTools });
  assertSafeCommand({ args });

  const started = Date.now();
  // No shell: arguments are passed as an array, so a prompt can never be
  // reinterpreted as shell syntax. On Windows this also resolves the .cmd
  // launcher to the executable it wraps, which Node cannot spawn directly.
  //
  // The prompt is a UTF-8 Buffer, not a string: spawnSync would encode a string
  // using `encoding` anyway, and passing the bytes directly removes any question
  // about what happens to Unicode on the way to the child.
  const proc = spawnCli(command, args, {
    cwd: worktree,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    input: Buffer.from(prompt ?? "", "utf8"),
  });

  const timedOut = proc.error?.code === "ETIMEDOUT" || proc.signal === "SIGTERM";
  const classified = classifyResult({
    status: proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? (proc.error ? String(proc.error.message) : ""),
    timedOut,
    spawnError: timedOut ? null : spawnFailure(proc),
  });

  return {
    ...classified,
    exitCode: proc.status ?? null,
    durationMs: Date.now() - started,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    // argv is now flags only, so the whole command is recordable verbatim. The
    // prompt SIZE is still recorded — that number is what identified the
    // ENAMETOOLONG failure, and losing it would cost the next diagnosis.
    command: `${redactCommand(command, args)} <stdin:${(prompt ?? "").length} chars>`,
  };
}

/** The real adapter, in the shape the engine expects. */
export const claudeBuilder = {
  name: "claude-code",
  build: invokeBuilder,
};
