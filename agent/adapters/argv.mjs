// Structured argv parsing for adapter safety checks.
//
// WHY THIS EXISTS
//
//   The first safety check joined argv into one string and substring-matched it
//   for forbidden flags. The Builder prompt is itself an argv element, and the
//   prompt embeds AGENTS.md, which documents "--dangerously-skip-permissions is
//   never used". So the guard matched its own documentation and refused a
//   perfectly safe command.
//
//   The same shape had a worse failure mode on the Reviewer: it asserted the
//   joined string CONTAINED "read-only", which the reviewed diff could satisfy
//   on its own — a dangerous sandbox would have passed. A false negative in a
//   safety check is far more serious than a false positive.
//
//   So: never inspect argv as text. Parse it into flags and values, and check
//   the flags. Prompt content is a VALUE and is never treated as a flag.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Parse an argv array into flags and positionals.
 *
 * `valueFlags` names the flags whose NEXT token is their value. Those values —
 * prompts, paths, session ids — are consumed and never examined as flags, which
 * is precisely what stops prompt text from being read as configuration.
 *
 * `--flag=value` is also understood.
 *
 * @param {string[]} args
 * @param {Set<string>} valueFlags
 * @returns {{ flags: Map<string, string|true>, positional: string[] }}
 */
export function parseArgv(args, valueFlags = new Set()) {
  const flags = new Map();
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (typeof token !== "string" || !token.startsWith("-") || token === "-" || token === "--") {
      positional.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    if (eq !== -1) {
      flags.set(token.slice(0, eq), token.slice(eq + 1));
      continue;
    }

    if (valueFlags.has(token)) {
      // Consume the next token as this flag's value. It is data, not config.
      flags.set(token, args[i + 1]);
      i += 1;
      continue;
    }

    flags.set(token, true);
  }

  return { flags, positional };
}

/** The flag tokens actually present, ignoring every value. */
export const flagNames = (parsed) => [...parsed.flags.keys()];

/**
 * A human-readable command for the run record, with bulky argv tokens replaced
 * by their length.
 *
 * Prompts carry the whole task, project memory and the diff. Writing them into
 * every round's log would bloat the record and copy task context into a second
 * place for no benefit — the prompt is already reproducible from the task. The
 * flags, which are what a reviewer actually needs to audit, stay verbatim.
 */
export function redactCommand(command, args, { maxToken = 200 } = {}) {
  const shown = args.map((token) =>
    typeof token === "string" && token.length > maxToken
      ? `<redacted:${token.length} chars>`
      : token,
  );
  return `${command} ${shown.join(" ")}`;
}

/* ── Windows-safe process launch ─────────────────────────────────────────── */
//
// WHY THIS EXISTS
//
//   A live run failed with exitCode null, durationMs 1 and empty stdout/stderr,
//   which the Builder then classified as "stdout was not valid JSON". Nothing
//   had run at all: since the CVE-2024-27980 fix, Node REFUSES to spawn a .cmd
//   or .bat without a shell and returns EINVAL. On Windows `claude` and `codex`
//   are npm .cmd launchers, so every invocation died before it started.
//
//   `shell: true` would "work" and is not an option: it hands a 31 KB prompt to
//   a command interpreter as text. Instead we recover the REAL executable the
//   launcher wraps and spawn that with the argv array untouched — no shell, no
//   quoting, and no interpreter between us and the CLI.
//
//   cmd.exe with the launcher as an argument is the fallback, not the primary
//   path, because cmd.exe truncates at 8191 characters: the measured Builder
//   prompt is 31,514, so cmd.exe cannot carry a real invocation.

const WINDOWS_LAUNCHER = /\.(cmd|bat)$/i;

/** cmd.exe refuses a command line longer than this. Measured, not folklore. */
const CMD_MAX_COMMAND_LINE = 8191;

/** Resolve a bare command name against PATH. Returns null if not found. */
function onPath(command) {
  if (command.includes("/") || command.includes(path.sep)) {
    return existsSync(command) ? command : null;
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Recover the real program an npm-generated Windows .cmd launcher wraps.
 *
 * Every npm shim ends with one line that forwards `%*` to its target, in one of
 * two shapes — a bundled .exe, or node plus a .js entry point:
 *
 *   "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
 *   ... || title %COMSPEC% & "%_prog%"  "%dp0%\...\cli.js" %*
 *
 * @returns {{ command: string, prefix: string[] } | null} null if the launcher
 *   is not a shape we recognise — the caller must then fall back rather than
 *   guess at a program to run.
 */
export function resolveWindowsLauncher(launcherPath) {
  let text;
  try {
    text = readFileSync(launcherPath, "utf8");
  } catch {
    return null;
  }

  const dp0 = path.dirname(launcherPath);
  const forwarding = text
    .split(/\r?\n/)
    .filter((line) => line.includes("%*"))
    .at(-1);
  if (!forwarding) return null;

  const tokens = [...forwarding.matchAll(/"([^"]*)"/g)]
    .map(([, token]) =>
      token
        // %_prog% is node.exe-or-`node`; our own node is the right one either way.
        .replace(/%_prog%/gi, process.execPath)
        .replace(/%dp0%[\\/]*/gi, `${dp0}${path.sep}`),
    )
    // Anything still holding a %VAR% is a shim variable we do not model.
    .filter((token) => token && !token.includes("%"));

  const [command, ...prefix] = tokens;
  if (!command || !existsSync(command)) return null;
  return { command, prefix };
}

/**
 * Quote one argument for cmd.exe so the child still receives it verbatim:
 * CRT quoting first (backslashes before a quote are doubled), then `^`-escaping
 * of every cmd metacharacter — including the wrapping quotes themselves.
 */
function escapeForCmd(arg) {
  const quoted = `"${String(arg)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(/(["&|<>^%!()])/g, "^$1");
}

/** A spawnSync-shaped result for a launch we refuse to attempt. */
const launchRefused = (message, code) => ({
  status: null,
  signal: null,
  stdout: "",
  stderr: "",
  error: Object.assign(new Error(message), { code }),
});

/**
 * spawnSync, but able to launch a Windows .cmd/.bat launcher.
 *
 * On every other platform, and for any real executable, this is plain
 * spawnSync with `shell: false` — macOS and Linux behaviour is unchanged.
 *
 * Arguments are always passed as an ARRAY. Prompt text is never concatenated
 * into a command string that an interpreter would parse.
 */
export function spawnCli(command, args, options = {}) {
  const spawnOptions = { ...options, shell: false };
  if (process.platform !== "win32" || !WINDOWS_LAUNCHER.test(command)) {
    return spawnSync(command, args, spawnOptions);
  }

  const launcher = onPath(command);
  const target = launcher && resolveWindowsLauncher(launcher);
  if (target) {
    return spawnSync(target.command, [...target.prefix, ...args], {
      ...spawnOptions,
      windowsHide: true,
    });
  }

  // Fallback: cmd.exe with the launcher as an ARGUMENT (never `shell: true`).
  if (!launcher) {
    return launchRefused(`${command} was not found on PATH`, "ENOENT");
  }
  const line = [launcher, ...args].map(escapeForCmd).join(" ");
  if (line.length > CMD_MAX_COMMAND_LINE) {
    return launchRefused(
      `cannot launch ${command}: it is not a launcher shape we can resolve, and its ` +
        `command line (${line.length} chars) exceeds the cmd.exe limit of ${CMD_MAX_COMMAND_LINE}`,
      "E2BIG",
    );
  }
  return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
    ...spawnOptions,
    windowsVerbatimArguments: true,
    windowsHide: true,
  });
}

/**
 * Did the process fail to LAUNCH, as opposed to running and exiting badly?
 *
 * This distinction is the whole point: a launch failure produces no stdout, and
 * "no stdout" must never be reported as malformed model output. A timeout is
 * excluded — that process did start, and the adapters classify it separately.
 *
 * @returns {{ category: string, detail: string } | null}
 */
export function spawnFailure(proc) {
  const error = proc?.error;
  if (!error || error.code === "ETIMEDOUT") return null;
  return {
    category: "PROCESS_SPAWN_ERROR",
    detail: `could not launch the CLI (${error.code ?? "spawn error"}): ${error.message}`,
  };
}

/**
 * An error the engine can recognise and turn into a controlled run status
 * instead of an uncaught stack trace.
 */
export class AdapterConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdapterConfigurationError";
    this.category = "adapter_configuration";
  }
}
