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
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateReview } from "../schemas.mjs";

export const DEFAULTS = {
  timeoutMs: 15 * 60 * 1000,
  sandbox: "read-only",
};

const CLI = process.platform === "win32" ? "codex.cmd" : "codex";

const UNSAFE_FLAGS = ["--full-auto", "danger-full-access", "--yolo", "workspace-write"];

/** Build the argv for a review. Pure, so tests can assert it without spawning. */
export function buildCommand({ prompt, worktree, outputFile, sandbox = DEFAULTS.sandbox } = {}) {
  const args = [
    "exec",
    "--sandbox",
    sandbox,
    "--cd",
    worktree ?? ".",
    "--skip-git-repo-check",
    "--output-last-message",
    outputFile,
    prompt ?? "",
  ];
  return { command: CLI, args };
}

/** Guard: refuse any command that would let the Reviewer write. */
export function assertSafeCommand({ args }) {
  const joined = args.join(" ");
  for (const flag of UNSAFE_FLAGS) {
    if (joined.includes(flag)) throw new Error(`refusing unsafe Reviewer flag: ${flag}`);
  }
  if (!joined.includes("read-only")) throw new Error("Reviewer must run with --sandbox read-only");
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
  const { command, args } = buildCommand({ prompt, worktree, outputFile, sandbox });
  assertSafeCommand({ args });

  const started = Date.now();
  let proc;
  let lastMessage = "";
  try {
    proc = spawnSync(command, args, {
      cwd: worktree,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
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
    command: `${command} ${args.join(" ")}`,
  };

  if (proc.error?.code === "ETIMEDOUT" || proc.signal === "SIGTERM") {
    return { ...base, outcome: "timeout", error: "Reviewer exceeded its timeout" };
  }
  if (USAGE.test(text)) return { ...base, outcome: "usage_limit", error: "usage limit reached" };
  if (AUTH.test(text))
    return { ...base, outcome: "auth_failure", error: "authentication required" };
  if (NETWORK.test(text)) return { ...base, outcome: "network_failure", error: "network error" };

  const parsed = parseReview(lastMessage);
  if (!parsed.ok) return { ...base, outcome: "malformed_output", error: parsed.error };

  return { ...base, outcome: "success", review: parsed.value };
}

/** The real adapter, in the shape the engine expects. */
export const codexReviewer = {
  name: "codex",
  review: invokeReviewer,
};
