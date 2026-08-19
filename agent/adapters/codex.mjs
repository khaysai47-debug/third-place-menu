// Codex Reviewer adapter.
//
// Invokes the installed `codex` CLI non-interactively as an INDEPENDENT review
// of the Builder's diff. The Reviewer never edits anything:
//
//   * --sandbox read-only  — Codex cannot write to the worktree at all.
//   * NEVER --full-auto, NEVER danger-full-access, NEVER --yolo.
//   * The diff arrives in the prompt, so the review does not depend on the
//     Reviewer poking around the filesystem.
//
// The verdict must parse cleanly. A review the runner cannot read is rejected as
// malformed rather than guessed at — an unreadable review must never become a
// silent PASS.
//
// THE PROMPT TRAVELS ON STDIN, NEVER IN ARGV — same fix as the Builder, same
// reason. The review prompt carries the whole diff, so it is the one prompt with
// no upper bound at all: recorded ATLAS-001 reviews already reached 29,707 and
// 30,812 characters against a 32,767 Windows command-line ceiling. It had not
// failed yet; it was one slightly larger diff away.
//
// `codex exec -` reads the instructions from stdin — the CLI's own help says so
// ("If not provided as an argument (or if `-` is used), instructions are read
// from stdin"), so `-` is the explicit, documented marker rather than a bare
// omission that could later be read as "no prompt".
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateReview } from "../schemas.mjs";
import {
  AdapterConfigurationError,
  flagNames,
  parseArgv,
  redactCommand,
  spawnCli,
  spawnFailure,
} from "./argv.mjs";

export const DEFAULTS = {
  timeoutMs: 15 * 60 * 1000,
  sandbox: "read-only",
};

const CLI = process.platform === "win32" ? "codex.cmd" : "codex";

/**
 * The stdin marker that replaces the prompt positional. Exported so the tests
 * assert the real token rather than a copy of it.
 */
export const STDIN_PROMPT = "-";

/**
 * Build the argv for a review. Pure, so tests can assert it without spawning.
 *
 * Takes NO prompt, for the same reason the Builder's does not: the prompt goes
 * on stdin, and a builder that cannot accept one cannot put a 30 KB diff back on
 * the command line by accident.
 */
export function buildCommand({ worktree, outputFile, sandbox = DEFAULTS.sandbox } = {}) {
  const args = [
    "exec",
    "--sandbox",
    sandbox,
    "--cd",
    worktree ?? ".",
    "--skip-git-repo-check",
    "--output-last-message",
    outputFile,
    STDIN_PROMPT,
  ];
  return { command: CLI, args };
}

/** Flags whose NEXT argv token is their value. The prompt is a positional. */
export const VALUE_FLAGS = new Set([
  "--sandbox",
  "-s",
  "--cd",
  "-C",
  "--output-last-message",
  "--model",
  "-m",
  "--config",
  "-c",
  "--image",
  "-i",
]);

/** Flags that must never appear as an actual argv FLAG token. */
export const UNSAFE_FLAGS = new Set([
  "--full-auto",
  "--yolo",
  "--dangerously-bypass-approvals-and-sandbox",
  "--skip-permissions",
]);

/** The only sandbox the Reviewer may run under. It must not be able to write. */
export const REQUIRED_SANDBOX = "read-only";

/**
 * Guard: refuse any command that would let the Reviewer write.
 *
 * Inspects only real argv flags and their values. The previous version joined
 * argv into a string and asserted it CONTAINED "read-only" — which the reviewed
 * diff could satisfy on its own, letting a `workspace-write` sandbox through.
 * That was a false negative in a safety check; this compares the actual value
 * of `--sandbox` instead.
 *
 * @throws {AdapterConfigurationError}
 */
export function assertSafeCommand({ args }) {
  const parsed = parseArgv(args, VALUE_FLAGS);
  const refuse = (message) => {
    throw new AdapterConfigurationError(message);
  };

  // The Reviewer argv has exactly two positionals: the `exec` subcommand and the
  // `-` stdin marker. Anything else means the prompt (with the whole diff in it)
  // has been put back on the command line — the ENAMETOOLONG shape. Never report
  // the tokens themselves; a leaked diff must not be echoed into a run record.
  if (parsed.positional.length !== 2 || parsed.positional[1] !== STDIN_PROMPT) {
    refuse(
      `Reviewer argv must be "exec" plus the "${STDIN_PROMPT}" stdin marker, got ` +
        `${parsed.positional.length} positional argument(s) — the prompt belongs on stdin`,
    );
  }

  for (const flag of flagNames(parsed)) {
    if (UNSAFE_FLAGS.has(flag)) refuse(`refusing unsafe Reviewer flag: ${flag}`);
  }

  const sandbox = parsed.flags.get("--sandbox") ?? parsed.flags.get("-s");
  if (sandbox !== REQUIRED_SANDBOX) {
    refuse(`Reviewer must run with --sandbox ${REQUIRED_SANDBOX}, got ${sandbox ?? "(unset)"}`);
  }

  return parsed;
}

/**
 * Extract the verdict object from the Reviewer's final message.
 *
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parseReview(text) {
  const fenced = [...String(text).matchAll(/```json\s*([\s\S]*?)```/gi)].at(-1);
  const raw = fenced ? fenced[1] : String(text);
  let value;
  try {
    value = JSON.parse(raw.trim());
  } catch (error) {
    return { ok: false, error: `reviewer output is not valid JSON: ${error.message}` };
  }
  const validation = validateReview(value);
  if (!validation.valid) {
    return { ok: false, error: `reviewer output failed schema: ${validation.errors.join("; ")}` };
  }
  return { ok: true, value };
}

const USAGE = /usage limit|rate.?limit|quota exceeded|too many requests|429/i;
const AUTH = /not logged in|unauthori[sz]ed|authentication|invalid api key|please run .*login|401/i;
const NETWORK =
  /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i;

/** Classify Reviewer process output without spawning, so ordering is testable. */
export function classifyResult({
  status,
  stdout = "",
  stderr = "",
  lastMessage = "",
  timedOut = false,
  spawnError = null,
} = {}) {
  if (timedOut) return { outcome: "timeout", error: "Reviewer exceeded its timeout" };
  if (spawnError) {
    return {
      outcome: "process_spawn_error",
      category: spawnError.category,
      error: spawnError.detail,
    };
  }

  const parsed = parseReview(lastMessage);
  // Codex stdout contains progress/reasoning text. When the CLI exited cleanly
  // and wrote a valid verdict, that text is not an operational error channel;
  // it may legitimately mention authentication or a 401 found in the diff.
  if (status === 0 && parsed.ok) return { outcome: "success", review: parsed.value };

  const text = `${stdout}\n${stderr}`;
  if (USAGE.test(text)) return { outcome: "usage_limit", error: "usage limit reached" };
  if (AUTH.test(text)) return { outcome: "auth_failure", error: "authentication required" };
  if (NETWORK.test(text)) return { outcome: "network_failure", error: "network error" };
  if (!parsed.ok) return { outcome: "malformed_output", error: parsed.error };
  return { outcome: "success", review: parsed.value };
}

/**
 * Run one review. Returns `{ outcome, review?, error? }` where outcome is
 * "success", "malformed_output", "usage_limit", "auth_failure",
 * "network_failure" or "timeout".
 */
export function invokeReviewer({
  prompt,
  worktree,
  timeoutMs = DEFAULTS.timeoutMs,
  sandbox = DEFAULTS.sandbox,
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-review-"));
  const outputFile = path.join(dir, "verdict.txt");
  const { command, args } = buildCommand({ worktree, outputFile, sandbox });
  assertSafeCommand({ args });

  const started = Date.now();
  let proc;
  let lastMessage = "";
  try {
    // Same Windows .cmd hazard as the Builder: never `shell: true`, and never
    // a concatenated command string carrying the reviewed diff. The prompt is a
    // UTF-8 Buffer on stdin, so the diff never touches the command line.
    proc = spawnCli(command, args, {
      cwd: worktree,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      input: Buffer.from(prompt ?? "", "utf8"),
    });
    try {
      lastMessage = readFileSync(outputFile, "utf8");
    } catch {
      lastMessage = proc.stdout ?? "";
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? (proc.error ? String(proc.error.message) : "");
  const text = `${stdout}\n${stderr}`;
  const base = {
    exitCode: proc.status ?? null,
    durationMs: Date.now() - started,
    stdout,
    stderr,
    lastMessage,
    // argv is flags plus `exec -` now, so it records verbatim. The prompt SIZE
    // stays visible — it is the number that diagnoses a command-length failure.
    command: `${redactCommand(command, args)} <stdin:${(prompt ?? "").length} chars>`,
  };

  const launch = spawnFailure(proc);
  return {
    ...base,
    ...classifyResult({
      status: proc.status,
      stdout,
      stderr,
      lastMessage,
      timedOut: proc.error?.code === "ETIMEDOUT" || proc.signal === "SIGTERM",
      spawnError: launch,
    }),
  };
}

/** The real adapter, in the shape the engine expects. */
export const codexReviewer = {
  name: "codex",
  review: invokeReviewer,
};
