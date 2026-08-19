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
  STDIN_PROMPT,
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

// A prompt mentioning forbidden flags was the ORIGINAL incident. It is now safe
// for a stronger reason than the guard being careful: the prompt is not in argv
// at all, so there is nothing for the guard to misread.
test("prompt text mentioning --dangerously-skip-permissions never reaches argv", () => {
  const prompt = [
    "Implement the task.",
    "HARD RULES:",
    "- The runner never passes --dangerously-skip-permissions.",
    "- bypassPermissions is never used.",
    "- --full-auto and --yolo are forbidden.",
  ].join("\n");

  const built = buildBuilderCommand();
  assert.doesNotThrow(() => assertBuilderSafe(built));

  // The prompt is nowhere in argv — buildCommand cannot even accept one.
  assert.ok(!built.args.includes(prompt));
  assert.ok(!built.args.join(" ").includes("--dangerously-skip-permissions"));
  assert.ok(!built.args.join(" ").includes("bypassPermissions"));
});

test("the REAL Builder prompt (which embeds AGENTS.md) never enters argv", () => {
  const prompt = builderPrompt({ task: TASK, repoRoot: process.cwd() });
  // AGENTS.md documents the forbidden flag; that is what broke the FIRST guard.
  assert.ok(
    prompt.includes("--dangerously-skip-permissions"),
    "precondition: project memory documents the forbidden flag",
  );
  const built = buildBuilderCommand();
  assert.doesNotThrow(() => assertBuilderSafe(built));
  for (const token of built.args) assert.ok(!token.includes("dangerously-skip-permissions"));
});

test("the REAL Reviewer prompt never enters argv either", () => {
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
  assert.ok(prompt.includes("--full-auto"), "precondition: prompt mentions the flag");
  const built = buildReviewerCommand({ worktree: "/tmp/wt", outputFile: "/tmp/o.txt" });
  assert.ok(!built.args.join(" ").includes("--full-auto"), "the diff must not be in argv");
  assert.deepEqual(built.args.slice(-1), [STDIN_PROMPT], "the prompt slot is the stdin marker");
  assert.doesNotThrow(() => assertReviewerSafe(built));
});

/* ── The prompt must never go back onto the command line ──────────────────── */

test("a prompt put back into Builder argv is refused at the boundary", () => {
  const built = buildBuilderCommand();
  built.args.push("a 32 KB prompt would go here");
  assert.throws(() => assertBuilderSafe(built), AdapterConfigurationError);
  assert.throws(() => assertBuilderSafe(built), /flags only|belongs on stdin/);

  // The refusal must not echo the token back into a run record.
  try {
    assertBuilderSafe(built);
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(!error.message.includes("32 KB prompt would go here"));
  }
});

test("a prompt put back into Reviewer argv is refused at the boundary", () => {
  const built = buildReviewerCommand({ worktree: "/w", outputFile: "/o" });
  built.args.push("the whole diff would go here");
  assert.throws(() => assertReviewerSafe(built), /stdin marker|belongs on stdin/);

  // Replacing the marker with a prompt is refused too — the count alone is not
  // what makes it safe.
  const swapped = buildReviewerCommand({ worktree: "/w", outputFile: "/o" });
  swapped.args[swapped.args.length - 1] = "diff --git a/x b/x";
  assert.throws(() => assertReviewerSafe(swapped), /stdin marker/);
});

/* ── Real unsafe configuration is still rejected ─────────────────────────── */

test("an actual --dangerously-skip-permissions argv token is rejected", () => {
  const built = buildBuilderCommand();
  built.args.push("--dangerously-skip-permissions");
  assert.throws(() => assertBuilderSafe(built), AdapterConfigurationError);
  assert.throws(() => assertBuilderSafe(built), /refusing unsafe Builder flag/);
});

test("dangerous permission modes are rejected", () => {
  for (const mode of ["bypassPermissions", "dangerouslySkipPermissions", "yolo"]) {
    const args = buildBuilderCommand().args.slice();
    args[args.indexOf("--permission-mode") + 1] = mode;
    assert.throws(
      () => assertBuilderSafe({ args }),
      /dangerous permission mode|unknown permission/,
    );
  }
  // An unknown mode is refused too — allow-list, not deny-list.
  const args = buildBuilderCommand().args.slice();
  args[args.indexOf("--permission-mode") + 1] = "someNewModeNobodyVetted";
  assert.throws(() => assertBuilderSafe({ args }), /unknown permission mode/);
});

test("other unsafe Builder flags are rejected", () => {
  for (const flag of ["--dangerously-allow-browser", "--no-sandbox", "--yolo"]) {
    const built = buildBuilderCommand();
    built.args.push(flag);
    assert.throws(() => assertBuilderSafe(built), /refusing unsafe Builder flag/);
  }
});

test("a missing or interactive configuration is rejected", () => {
  // Drop ONLY --print. It is a boolean now, so removing it removes no value.
  const noPrint = buildBuilderCommand().args.filter((a) => a !== "--print");
  assert.throws(() => assertBuilderSafe({ args: noPrint }), /non-interactively/);

  const noMode = buildBuilderCommand().args.filter(
    (a, i, all) => a !== "--permission-mode" && all[i - 1] !== "--permission-mode",
  );
  assert.throws(() => assertBuilderSafe({ args: noMode }), /explicit --permission-mode/);
});

/* ── The intended configuration ──────────────────────────────────────────── */

test("the intended acceptEdits configuration passes and is exactly as designed", () => {
  const { command, args } = buildBuilderCommand({ maxTurns: 30 });
  assert.match(command, /claude/);

  const parsed = assertBuilderSafe({ args });
  assert.equal(parsed.flags.get("--permission-mode"), "acceptEdits");
  assert.equal(parsed.flags.get("--output-format"), "json");
  assert.equal(parsed.flags.get("--max-turns"), "30");
  // --print is a BOOLEAN now. If it were still a value-flag, parseArgv would
  // swallow --output-format as its value and the two asserts above would break —
  // which is exactly the failure mode requirement 6 names.
  assert.equal(parsed.flags.get("--print"), true, "--print takes no value");
  assert.deepEqual(parsed.positional, [], "the Builder argv is flags only");
  assert.equal(args.includes("-p"), false, "one spelling only");
});

test("Bash, WebFetch, WebSearch and NotebookEdit remain disallowed", () => {
  assert.deepEqual(REQUIRED_DISALLOWED_TOOLS, ["Bash", "WebFetch", "WebSearch", "NotebookEdit"]);
  assert.deepEqual(BUILDER_DEFAULTS.disallowedTools, REQUIRED_DISALLOWED_TOOLS);

  // Dropping any one of them is refused.
  for (const tool of REQUIRED_DISALLOWED_TOOLS) {
    const kept = REQUIRED_DISALLOWED_TOOLS.filter((t) => t !== tool);
    const built = buildBuilderCommand({ disallowedTools: kept });
    assert.throws(() => assertBuilderSafe(built), new RegExp(`must disallow the ${tool} tool`));
  }

  // Re-allowing one through --allowedTools is refused too.
  for (const grant of ["Bash", "Bash(git:*)", "WebFetch"]) {
    const built = buildBuilderCommand();
    built.args.push("--allowedTools", grant);
    assert.throws(() => assertBuilderSafe(built), /refusing to re-allow/);
  }
});

test("a session id cannot smuggle a flag", () => {
  assert.throws(
    () => buildBuilderCommand({ sessionId: "--dangerously-skip-permissions" }),
    AdapterConfigurationError,
  );
  const ok = buildBuilderCommand({ sessionId: "abc-123_XYZ.4" });
  assert.deepEqual(ok.args.slice(-2), ["--resume", "abc-123_XYZ.4"]);
  assert.doesNotThrow(() => assertBuilderSafe(ok));
});

/* ── Reviewer ────────────────────────────────────────────────────────────── */

test("the Reviewer must actually be read-only, not merely mention it", () => {
  const good = buildReviewerCommand({ worktree: "/tmp/wt", outputFile: "/tmp/o" });
  assert.doesNotThrow(() => assertReviewerSafe(good));

  for (const sandbox of ["workspace-write", "danger-full-access"]) {
    const built = buildReviewerCommand({ worktree: "/tmp/wt", outputFile: "/tmp/o", sandbox });
    assert.throws(() => assertReviewerSafe(built), /must run with --sandbox read-only/);
  }

  // A command with no --sandbox at all is refused. Well-formed positionals, so
  // the sandbox check is what rejects it rather than the stdin-marker check.
  assert.throws(
    () => assertReviewerSafe({ args: ["exec", "--cd", "/tmp/wt", STDIN_PROMPT] }),
    /must run with --sandbox read-only/,
  );
});

test("unsafe Reviewer flags are rejected", () => {
  for (const flag of ["--full-auto", "--yolo", "--dangerously-bypass-approvals-and-sandbox"]) {
    const built = buildReviewerCommand({ worktree: "/w", outputFile: "/o" });
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
      const fullPrompt = builderPrompt({ task: TASK, repoRoot: process.cwd() });
      // Exercise the cmd.exe boundary without crossing Windows' separate
      // CreateProcess limit. Real adapters put the full prompt on stdin; this
      // test is specifically about resolving a .cmd launcher to its real exe.
      const prompt = fullPrompt.slice(0, 16_000);
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

/* ── The stdin transport ─────────────────────────────────────────────────── */
//
// The regression: ATLAS-002 died with ENAMETOOLONG before implementation. Its
// prompt (32,538 chars) built a 32,928-char Windows command line against a
// 32,767 limit. ATLAS-001 (31,514 → 31,950) had fit with 817 to spare. The
// prompt only grows, so argv was never a viable transport.

/** A shim that echoes its argv AND everything it read from stdin, as JSON. */
function stdinShimDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-stdin-"));
  writeFileSync(
    path.join(dir, "echo-io.js"),
    [
      "const chunks = [];",
      "process.stdin.on('data', (c) => chunks.push(c));",
      "process.stdin.on('end', () => {",
      "  const stdin = Buffer.concat(chunks);",
      "  process.stdout.write(JSON.stringify({",
      "    argv: process.argv.slice(2),",
      "    stdin: stdin.toString('utf8'),",
      "    bytes: stdin.length,",
      "  }));",
      "});",
      "",
    ].join("\n"),
  );
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
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\echo-io.js" %*',
      "",
    ].join("\r\n"),
  );
  return dir;
}

/**
 * The hostile prompt: every class of character that a command line, a shell, or
 * cmd.exe would mangle — plus the forbidden-flag text that caused the original
 * incident, plus Unicode well outside the BMP.
 */
const HOSTILE_PROMPT = [
  "Implement the task & do not stop.",
  'A "quoted" phrase, 100% > 50% | pipes ^ carets, $(subshell), `backticks`.',
  "The runner never passes --dangerously-skip-permissions or --yolo.",
  "%PATH% %USERPROFILE% !DELAYED! must survive as literal text.",
  "trailing backslash dir\\  and a lone -  and a --",
  "Unicode: ไทย 中文 emoji 🍜🇹🇭 combining é za\u0301 zero-width\u200bhere",
  "Newlines\r\nand\ttabs\tand a NUL-adjacent \u0001 control char.",
].join("\n");

test(
  "a prompt far larger than the Windows command-line limit survives on stdin",
  { skip: process.platform !== "win32" ? "Windows-only launcher path" : false },
  () => {
    const dir = stdinShimDir();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${dir}${path.delimiter}${originalPath}`;

      // Comfortably past the 32,767 ceiling that killed ATLAS-002, and built
      // from the hostile text so size and content are tested together.
      const prompt = `${HOSTILE_PROMPT}\n`.repeat(1000);
      assert.ok(prompt.length > 60_000, `prompt is ${prompt.length} chars`);

      const args = buildBuilderCommand().args;
      const proc = spawnCli("probe.cmd", args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        input: Buffer.from(prompt, "utf8"),
      });

      assert.equal(proc.error, undefined, `spawn failed: ${proc.error?.message}`);
      assert.equal(proc.status, 0, `stderr: ${proc.stderr}`);

      const seen = JSON.parse(proc.stdout);
      // 1. It arrives byte-for-byte.
      assert.equal(seen.stdin, prompt, "the prompt must survive unmodified");
      assert.equal(seen.bytes, Buffer.byteLength(prompt, "utf8"), "byte count must match");
      // 2. It is nowhere in argv.
      assert.deepEqual(seen.argv, args);
      assert.ok(!seen.argv.join("\u0000").includes("dangerously-skip-permissions"));
      assert.ok(!seen.argv.some((token) => token.length > 200));
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a Reviewer-sized diff prompt also travels on stdin, not the command line",
  { skip: process.platform !== "win32" ? "Windows-only launcher path" : false },
  () => {
    const dir = stdinShimDir();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${dir}${path.delimiter}${originalPath}`;

      // Recorded ATLAS-001 reviews already reached 30,812 chars. Go well past.
      const diff = "diff --git a/x b/x\n+// with --full-auto in the text\n".repeat(1200);
      const prompt = reviewerPrompt({
        task: TASK,
        changedFiles: ["src/x.ts"],
        diff,
        checkResults: [],
        builderSummary: "s",
      });
      assert.ok(prompt.length > 40_000, `review prompt is ${prompt.length} chars`);

      const args = buildReviewerCommand({ worktree: "/tmp/wt", outputFile: "/tmp/o.txt" }).args;
      const proc = spawnCli("probe.cmd", args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        input: Buffer.from(prompt, "utf8"),
      });

      assert.equal(proc.error, undefined, `spawn failed: ${proc.error?.message}`);
      const seen = JSON.parse(proc.stdout);
      assert.equal(seen.stdin, prompt);
      assert.deepEqual(seen.argv, args);
      assert.ok(!seen.argv.join("\u0000").includes("--full-auto"), "the diff is not in argv");
      assert.equal(seen.argv.at(-1), STDIN_PROMPT);
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("stdin input reaches a plainly-spawned executable too (POSIX path)", () => {
  const prompt = HOSTILE_PROMPT.repeat(500);
  const proc = spawnCli(
    process.execPath,
    ["-e", "process.stdin.on('data',(c)=>process.stdout.write(c))"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, input: Buffer.from(prompt, "utf8") },
  );
  assert.equal(proc.error, undefined);
  assert.equal(proc.stdout, prompt, "byte-for-byte on the non-launcher branch");
});

test("the measured ATLAS-002 argv no longer approaches the Windows limit", () => {
  // The whole point: argv is now a fixed handful of flags whatever the task is.
  const { command, args } = buildBuilderCommand({ maxTurns: 30 });
  const argvChars = [command, ...args].join(" ").length;
  assert.ok(argvChars < 200, `Builder argv is ${argvChars} chars, was 32,678`);

  const review = buildReviewerCommand({
    worktree: "D:\\Projects\\third-place-menu-agent-worktrees\\ATLAS-002",
    outputFile: "C:\\Users\\User\\AppData\\Local\\Temp\\atlas-review-abc123\\verdict.txt",
  });
  const reviewChars = [review.command, ...review.args].join(" ").length;
  assert.ok(reviewChars < 300, `Reviewer argv is ${reviewChars} chars, was 30,900+`);
});

/* ── No secrets in the recorded command ──────────────────────────────────── */

test("the recorded command carries no prompt text", () => {
  const prompt = builderPrompt({ task: TASK, repoRoot: process.cwd() });
  const { command, args } = buildBuilderCommand();
  const recorded = redactCommand(command, args);

  assert.ok(recorded.length < 400, "the record must not carry the whole prompt");
  assert.ok(!recorded.includes(prompt));
  // Nothing needs redacting any more: argv is flags only, so the whole command
  // is auditable verbatim.
  assert.ok(!recorded.includes("<redacted:"));
  assert.match(recorded, /--permission-mode acceptEdits/);
  assert.match(recorded, /--disallowedTools Bash,WebFetch,WebSearch,NotebookEdit/);
  // Nothing that looks like a credential.
  for (const word of ["token", "secret", "password", "api-key", "apiKey"]) {
    assert.ok(!recorded.toLowerCase().includes(word.toLowerCase()));
  }
});
