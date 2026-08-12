// Adapter safety regression tests. Run with `npm run agent:test`.
//
// These exist because of a real incident: a live ATLAS-001 run refused to start
// with "refusing unsafe Builder flag: --dangerously-skip-permissions" when no
// such flag was configured. The guard was substring-matching the joined argv,
// and the Builder prompt embeds AGENTS.md, which documents that very flag.
//
// The launch tests below DO spawn a process — but only `node` against a
// throwaway shim in a temp directory. No Claude, no Codex, no network, no quota.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  AdapterConfigurationError,
  parseArgv,
  redactCommand,
  resolveWindowsLauncher,
  spawnCli,
  spawnFailure,
} from "./adapters/argv.mjs";
import {
  assertSafeCommand as assertBuilderSafe,
  buildCommand as buildBuilderCommand,
  classifyResult,
  DEFAULTS as BUILDER_DEFAULTS,
  REQUIRED_DISALLOWED_TOOLS,
} from "./adapters/claude.mjs";
import {
  assertSafeCommand as assertReviewerSafe,
  buildCommand as buildReviewerCommand,
} from "./adapters/codex.mjs";
import { builderPrompt, reviewerPrompt } from "./prompts.mjs";
import { BUILDER_OUTCOMES } from "./schemas.mjs";

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

/* ── Windows .cmd launching ──────────────────────────────────────────────── */
//
// The regression: a live run reported exitCode null, durationMs 1, empty
// stdout/stderr and "stdout was not valid JSON". Node had refused to spawn
// claude.cmd with EINVAL, so nothing ran — and the silence was blamed on the
// model instead of on the runner.

/** Build a throwaway npm-style shim directory. Returns its path. */
function shimDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-shim-"));
  writeFileSync(
    path.join(dir, "echo-argv.js"),
    "console.log(JSON.stringify(process.argv.slice(2)));\n",
  );
  // npm shape 2: node plus a .js entry point.
  writeFileSync(
    path.join(dir, "probe.cmd"),
    [
      "@ECHO off",
      "SETLOCAL",
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ") ELSE (",
      '  SET "_prog=node"',
      ")",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\echo-argv.js" %*',
      "",
    ].join("\r\n"),
  );
  return dir;
}

test("an npm .cmd launcher resolves to the real program it wraps", () => {
  const dir = shimDir();
  try {
    // Shape 2: node + .js entry point.
    const viaNode = resolveWindowsLauncher(path.join(dir, "probe.cmd"));
    assert.equal(viaNode.command, process.execPath, "%_prog% resolves to our node");
    assert.deepEqual(viaNode.prefix, [path.join(dir, "echo-argv.js")]);

    // Shape 1: a bundled .exe, which is what the installed claude.cmd uses.
    writeFileSync(path.join(dir, "tool.exe"), "");
    writeFileSync(path.join(dir, "exe.cmd"), '@ECHO off\r\n"%dp0%\\tool.exe"   %*\r\n');
    const viaExe = resolveWindowsLauncher(path.join(dir, "exe.cmd"));
    assert.equal(viaExe.command, path.join(dir, "tool.exe"));
    assert.deepEqual(viaExe.prefix, [], "the exe takes the argv directly");

    // A shim shape we do not model resolves to null so the caller can fall back
    // rather than invent a program to run.
    writeFileSync(path.join(dir, "weird.cmd"), "@ECHO off\r\nsomething-else %*\r\n");
    assert.equal(resolveWindowsLauncher(path.join(dir, "weird.cmd")), null);
    assert.equal(resolveWindowsLauncher(path.join(dir, "does-not-exist.cmd")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "spawnCli runs a .cmd launcher and delivers argv verbatim",
  { skip: process.platform !== "win32" ? "Windows-only launcher path" : false },
  () => {
    const dir = shimDir();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${dir}${path.delimiter}${originalPath}`;

      // Every hazard at once: cmd metacharacters, quotes, an env-var reference,
      // a leading-dash token, embedded newlines, and forbidden-flag TEXT.
      const args = [
        "--print",
        [
          "Implement the task & do not stop.",
          'A "quoted" phrase with 100% > 50% | pipes ^ carets.',
          "The runner never passes --dangerously-skip-permissions.",
          "%PATH% and %USERPROFILE% must survive as literal text.",
          "trailing backslash dir\\",
        ].join("\n"),
        "--output-format",
        "json",
      ];

      const proc = spawnCli("probe.cmd", args, { encoding: "utf8" });
      assert.equal(proc.error, undefined, `spawn failed: ${proc.error?.message}`);
      assert.equal(proc.status, 0, `stderr: ${proc.stderr}`);
      assert.deepEqual(JSON.parse(proc.stdout), args, "argv must arrive unmodified");
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a real Builder-sized prompt survives the Windows launch path",
  { skip: process.platform !== "win32" ? "Windows-only launcher path" : false },
  () => {
    const dir = shimDir();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
      const prompt = builderPrompt({ task: TASK, repoRoot: process.cwd() });
      // cmd.exe caps a command line at 8191 characters, so a fallback through
      // cmd.exe could not carry this. The launcher must resolve to a real exe.
      assert.ok(prompt.length > 8191, `precondition: prompt is ${prompt.length} chars`);

      const proc = spawnCli("probe.cmd", ["--print", prompt], { encoding: "utf8" });
      assert.equal(proc.error, undefined, `spawn failed: ${proc.error?.message}`);
      assert.deepEqual(JSON.parse(proc.stdout), ["--print", prompt]);
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("macOS and Linux behaviour is unchanged: a plain executable spawns directly", () => {
  const proc = spawnCli(process.execPath, ["-e", "process.stdout.write('ok')"], {
    encoding: "utf8",
  });
  assert.equal(proc.error, undefined);
  assert.equal(proc.stdout, "ok");
});

/* ── Spawn failures are never "malformed output" ─────────────────────────── */

test("a launch failure is detected explicitly, and a timeout is not one", () => {
  assert.equal(spawnFailure({ status: 0 }), null, "a process that ran is not a launch failure");

  const einval = spawnFailure({
    error: Object.assign(new Error("spawnSync x EINVAL"), {
      code: "EINVAL",
    }),
  });
  assert.equal(einval.category, "PROCESS_SPAWN_ERROR");
  assert.match(einval.detail, /EINVAL/);

  // A timeout DID start a process; the adapters classify it as a timeout.
  assert.equal(
    spawnFailure({ error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) }),
    null,
  );
});

test("a missing launcher fails to spawn instead of pretending it ran", () => {
  const proc = spawnCli("atlas-no-such-cli.cmd", ["--print", "p"], { encoding: "utf8" });
  if (process.platform === "win32") {
    assert.ok(spawnFailure(proc), "an unresolvable .cmd must report a launch failure");
  } else {
    assert.ok(proc.error, "a missing executable still errors on POSIX");
  }
});

test("the exact live failure is classified as PROCESS_SPAWN_ERROR, not malformed JSON", () => {
  // Reproduces the run record verbatim: exitCode null, no output at all.
  const live = {
    status: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    spawnError: {
      category: "PROCESS_SPAWN_ERROR",
      detail: "could not launch the CLI (EINVAL): spawnSync claude.cmd EINVAL",
    },
  };
  const classified = classifyResult(live);
  assert.equal(classified.outcome, "process_spawn_error");
  assert.notEqual(classified.outcome, "malformed_output", "the model never got to say anything");
  assert.equal(classified.category, "PROCESS_SPAWN_ERROR");
  assert.match(classified.detail, /EINVAL/, "the detail must name the real cause");

  // Without the spawn error, that same empty stdout IS malformed output.
  assert.equal(classifyResult({ ...live, spawnError: null }).outcome, "malformed_output");

  // A timeout still wins: that process started.
  assert.equal(classifyResult({ ...live, timedOut: true }).outcome, "timeout");
});

test("process_spawn_error is a declared Builder outcome", () => {
  assert.ok(BUILDER_OUTCOMES.includes("process_spawn_error"));
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
