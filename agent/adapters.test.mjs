// Adapter safety regression tests. Run with `npm run agent:test`.
//
// These exist because of a real incident: a live ATLAS-001 run refused to start
// with "refusing unsafe Builder flag: --dangerously-skip-permissions" when no
// such flag was configured. The guard was substring-matching the joined argv,
// and the Builder prompt embeds AGENTS.md, which documents that very flag.
//
// Nothing here spawns a process. No Claude, no Codex, no network, no quota.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AdapterConfigurationError, parseArgv, redactCommand } from "./adapters/argv.mjs";
import {
  assertSafeCommand as assertBuilderSafe,
  buildCommand as buildBuilderCommand,
  DEFAULTS as BUILDER_DEFAULTS,
  REQUIRED_DISALLOWED_TOOLS,
} from "./adapters/claude.mjs";
import {
  assertSafeCommand as assertReviewerSafe,
  buildCommand as buildReviewerCommand,
} from "./adapters/codex.mjs";
import { builderPrompt, reviewerPrompt } from "./prompts.mjs";

const TASK = {
  taskId: "TEST-ADAPTER",
  title: "Adapter fixture",
  objective: "Exercise the safety guard.",
  context: "Fixture only.",
  owner: "claude-builder",
  riskLevel: "low",
  baseCommit: "a".repeat(40),
  allowedPaths: ["src/"],
  forbiddenPaths: ["api/"],
  acceptanceCriteria: ["Nothing real happens."],
  requiredChecks: ["typecheck"],
  permissions: ["read_repository"],
  stoppingRules: ["Stop on anything unexpected."],
};

/* ── The regression that caused the incident ─────────────────────────────── */

test("a prompt that MENTIONS --dangerously-skip-permissions is still safe", () => {
  const prompt = [
    "Implement the task.",
    "HARD RULES:",
    "- The runner never passes --dangerously-skip-permissions.",
    "- bypassPermissions is never used.",
    "- --full-auto and --yolo are forbidden.",
  ].join("\n");

  const built = buildBuilderCommand({ prompt });
  // Must not throw: the flag names appear in prompt TEXT, not in configuration.
  assert.doesNotThrow(() => assertBuilderSafe(built));

  // And the prompt really is in there — otherwise this test proves nothing.
  assert.ok(built.args.includes(prompt));
  assert.ok(built.args.join(" ").includes("--dangerously-skip-permissions"));
});

test("the REAL Builder prompt (which embeds AGENTS.md) passes the guard", () => {
  const prompt = builderPrompt({ task: TASK, repoRoot: process.cwd() });
  // AGENTS.md documents the forbidden flag; that is what broke the old guard.
  assert.ok(
    prompt.includes("--dangerously-skip-permissions"),
    "precondition: project memory documents the forbidden flag",
  );
  assert.doesNotThrow(() => assertBuilderSafe(buildBuilderCommand({ prompt })));
});

test("the REAL Reviewer prompt passes even when the diff mentions dangerous flags", () => {
  const diff = [
    "diff --git a/x b/x",
    "+// never run codex with --full-auto or --sandbox workspace-write",
    "+// and never danger-full-access",
  ].join("\n");
  const prompt = reviewerPrompt({
    task: TASK,
    changedFiles: ["src/x.ts"],
    diff,
    checkResults: [],
    builderSummary: "s",
  });
  const built = buildReviewerCommand({ prompt, worktree: "/tmp/wt", outputFile: "/tmp/o.txt" });
  assert.ok(built.args.join(" ").includes("--full-auto"), "precondition: prompt mentions the flag");
  assert.doesNotThrow(() => assertReviewerSafe(built));
});

/* ── Real unsafe configuration is still rejected ─────────────────────────── */

test("an actual --dangerously-skip-permissions argv token is rejected", () => {
  const built = buildBuilderCommand({ prompt: "safe prompt" });
  built.args.push("--dangerously-skip-permissions");
  assert.throws(() => assertBuilderSafe(built), AdapterConfigurationError);
  assert.throws(() => assertBuilderSafe(built), /refusing unsafe Builder flag/);
});

test("dangerous permission modes are rejected", () => {
  for (const mode of ["bypassPermissions", "dangerouslySkipPermissions", "yolo"]) {
    const args = buildBuilderCommand({ prompt: "p" }).args.slice();
    args[args.indexOf("--permission-mode") + 1] = mode;
    assert.throws(
      () => assertBuilderSafe({ args }),
      /dangerous permission mode|unknown permission/,
    );
  }
  // An unknown mode is refused too — allow-list, not deny-list.
  const args = buildBuilderCommand({ prompt: "p" }).args.slice();
  args[args.indexOf("--permission-mode") + 1] = "someNewModeNobodyVetted";
  assert.throws(() => assertBuilderSafe({ args }), /unknown permission mode/);
});

test("other unsafe Builder flags are rejected", () => {
  for (const flag of ["--dangerously-allow-browser", "--no-sandbox", "--yolo"]) {
    const built = buildBuilderCommand({ prompt: "p" });
    built.args.push(flag);
    assert.throws(() => assertBuilderSafe(built), /refusing unsafe Builder flag/);
  }
});

test("a missing or interactive configuration is rejected", () => {
  const noPrint = buildBuilderCommand({ prompt: "p" }).args.slice(2);
  assert.throws(() => assertBuilderSafe({ args: noPrint }), /non-interactively/);

  const noMode = buildBuilderCommand({ prompt: "p" }).args.filter(
    (a, i, all) => a !== "--permission-mode" && all[i - 1] !== "--permission-mode",
  );
  assert.throws(() => assertBuilderSafe({ args: noMode }), /explicit --permission-mode/);
});

/* ── The intended configuration ──────────────────────────────────────────── */

test("the intended acceptEdits configuration passes and is exactly as designed", () => {
  const { command, args } = buildBuilderCommand({ prompt: "p", maxTurns: 30 });
  assert.match(command, /claude/);

  const parsed = assertBuilderSafe({ args });
  assert.equal(parsed.flags.get("--permission-mode"), "acceptEdits");
  assert.equal(parsed.flags.get("--output-format"), "json");
  assert.equal(parsed.flags.get("--max-turns"), "30");
  assert.equal(parsed.flags.get("--print"), "p", "the prompt is a VALUE, never a flag");
});

test("Bash, WebFetch, WebSearch and NotebookEdit remain disallowed", () => {
  assert.deepEqual(REQUIRED_DISALLOWED_TOOLS, ["Bash", "WebFetch", "WebSearch", "NotebookEdit"]);
  assert.deepEqual(BUILDER_DEFAULTS.disallowedTools, REQUIRED_DISALLOWED_TOOLS);

  // Dropping any one of them is refused.
  for (const tool of REQUIRED_DISALLOWED_TOOLS) {
    const kept = REQUIRED_DISALLOWED_TOOLS.filter((t) => t !== tool);
    const built = buildBuilderCommand({ prompt: "p", disallowedTools: kept });
    assert.throws(() => assertBuilderSafe(built), new RegExp(`must disallow the ${tool} tool`));
  }

  // Re-allowing one through --allowedTools is refused too.
  for (const grant of ["Bash", "Bash(git:*)", "WebFetch"]) {
    const built = buildBuilderCommand({ prompt: "p" });
    built.args.push("--allowedTools", grant);
    assert.throws(() => assertBuilderSafe(built), /refusing to re-allow/);
  }
});

test("a session id cannot smuggle a flag", () => {
  assert.throws(
    () => buildBuilderCommand({ prompt: "p", sessionId: "--dangerously-skip-permissions" }),
    AdapterConfigurationError,
  );
  const ok = buildBuilderCommand({ prompt: "p", sessionId: "abc-123_XYZ.4" });
  assert.deepEqual(ok.args.slice(-2), ["--resume", "abc-123_XYZ.4"]);
  assert.doesNotThrow(() => assertBuilderSafe(ok));
});

/* ── Reviewer ────────────────────────────────────────────────────────────── */

test("the Reviewer must actually be read-only, not merely mention it", () => {
  const good = buildReviewerCommand({ prompt: "p", worktree: "/tmp/wt", outputFile: "/tmp/o" });
  assert.doesNotThrow(() => assertReviewerSafe(good));

  for (const sandbox of ["workspace-write", "danger-full-access"]) {
    const built = buildReviewerCommand({
      // The old guard passed whenever "read-only" appeared ANYWHERE, including
      // in the prompt. This prompt says it; the sandbox does not.
      prompt: "please note this review is read-only",
      worktree: "/tmp/wt",
      outputFile: "/tmp/o",
      sandbox,
    });
    assert.throws(() => assertReviewerSafe(built), /must run with --sandbox read-only/);
  }

  // A command with no --sandbox at all is refused.
  assert.throws(
    () => assertReviewerSafe({ args: ["exec", "--cd", "/tmp/wt", "read-only in the prompt"] }),
    /must run with --sandbox read-only/,
  );
});

test("unsafe Reviewer flags are rejected", () => {
  for (const flag of ["--full-auto", "--yolo", "--dangerously-bypass-approvals-and-sandbox"]) {
    const built = buildReviewerCommand({ prompt: "p", worktree: "/w", outputFile: "/o" });
    built.args.push(flag);
    assert.throws(() => assertReviewerSafe(built), /refusing unsafe Reviewer flag/);
  }
});

/* ── argv parsing ────────────────────────────────────────────────────────── */

test("parseArgv treats flag values as data, never as flags", () => {
  const parsed = parseArgv(
    ["--print", "--dangerously-skip-permissions", "--max-turns", "5"],
    new Set(["--print", "--max-turns"]),
  );
  assert.equal(parsed.flags.get("--print"), "--dangerously-skip-permissions");
  assert.equal(parsed.flags.has("--dangerously-skip-permissions"), false, "a VALUE is not a flag");
  assert.equal(parsed.flags.get("--max-turns"), "5");

  // --flag=value form
  const eq = parseArgv(["--permission-mode=acceptEdits"], new Set());
  assert.equal(eq.flags.get("--permission-mode"), "acceptEdits");

  // Positionals stay positional.
  const pos = parseArgv(["exec", "--sandbox", "read-only", "the prompt"], new Set(["--sandbox"]));
  assert.deepEqual(pos.positional, ["exec", "the prompt"]);
});

/* ── No secrets in the recorded command ──────────────────────────────────── */

test("the recorded command redacts bulky prompt text", () => {
  const prompt = builderPrompt({ task: TASK, repoRoot: process.cwd() });
  const { command, args } = buildBuilderCommand({ prompt });
  const recorded = redactCommand(command, args);

  assert.ok(recorded.length < 400, "the record must not carry the whole prompt");
  assert.ok(!recorded.includes(prompt));
  assert.match(recorded, /<redacted:\d+ chars>/);
  // The flags a reviewer needs to audit are still visible verbatim.
  assert.match(recorded, /--permission-mode acceptEdits/);
  assert.match(recorded, /--disallowedTools Bash,WebFetch,WebSearch,NotebookEdit/);
  // Nothing that looks like a credential.
  for (const word of ["token", "secret", "password", "api-key", "apiKey"]) {
    assert.ok(!recorded.toLowerCase().includes(word.toLowerCase()));
  }
});
