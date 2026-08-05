// Local check runner. Every check maps onto an existing package.json script so
// there is exactly one definition of what "typecheck" means in this repo.
//
// `format` is deliberately absent: `prettier --write` mutates the working tree,
// which a verification step must never do.
//
// Lint is baseline-aware. The repository carries pre-existing lint debt (317
// errors after line-ending normalization, D-012) that is nobody's task to fix in
// passing. Errors in files a run changed are that run's problem; errors in files
// it never opened are baseline. See project/TEST_MATRIX.md and decisions D-009
// and D-012.
//
// Every check accepts a `cwd`, because an execution run's checks must run inside
// the isolated worktree, not in the main checkout.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ALLOWED_CHECKS } from "./schemas.mjs";

// Node refuses to spawn a Windows .cmd shim without `shell: true`, so eslint is
// invoked through its own JS entry point instead of npx: no shell, no quoting
// hazard, and the JSON report arrives intact.
const eslintBin = (cwd) => path.join(cwd, "node_modules", "eslint", "bin", "eslint.js");

/** check name -> npm script name */
export const CHECK_SCRIPTS = {
  typecheck: "typecheck",
  lint: "lint",
  build: "build",
};

/**
 * Baseline classification is by OWNERSHIP, not by rule: eslint errors are
 * per-file, so an error in a file the run never opened cannot be the run's
 * fault. Errors in changed files are always the run's problem, whatever the
 * rule — including a stray CR, because the agent wrote that line.
 *
 * The CRLF debt is the dominant part of the baseline but not all of it, so it
 * is counted separately and reported, never merged into one opaque number.
 */
export const LINT_BASELINE = {
  id: "crlf-line-endings",
  ruleId: "prettier/prettier",
  // U+240D SYMBOL FOR CARRIAGE RETURN, as emitted by eslint-plugin-prettier.
  pattern: /␍/,
  description:
    "Repository is stored LF and checked out CRLF; prettier reports a stray CR on every line.",
};

/**
 * eslint reports absolute paths; make them relative to the directory the check
 * ran in so they line up with the task's repo-relative allowedPaths.
 */
const relativeTo = (file, cwd) => {
  const rel = path.relative(cwd, file);
  return (rel.startsWith("..") ? file : rel).replace(/\\/g, "/");
};

const normalize = (file) => file.replace(/\\/g, "/").replace(/^\.\//, "");

/** Is this message the known CRLF debt? Used for reporting, not for blame. */
export const isCrlfMessage = (message) =>
  message.ruleId === LINT_BASELINE.ruleId && LINT_BASELINE.pattern.test(message.message ?? "");

/**
 * Split eslint JSON results into new (owned) and baseline (unowned) errors.
 * Pure — separated from process execution so it can be tested directly.
 *
 * @param {Array} eslintResults eslint --format json output
 * @param {Set<string>} owned   normalized repo-relative paths the run changed
 */
export function classifyLintResults(eslintResults, owned = new Set(), cwd = process.cwd()) {
  const newFailures = [];
  const baselineFailures = [];
  let crlf = 0;
  let other = 0;

  for (const file of eslintResults) {
    const path = relativeTo(file.filePath, cwd);
    for (const message of file.messages) {
      if (message.severity !== 2) continue;
      const entry = {
        file: path,
        line: message.line,
        rule: message.ruleId,
        message: message.message,
      };
      if (owned.has(path)) {
        newFailures.push(entry);
        continue;
      }
      baselineFailures.push(entry);
      if (isCrlfMessage(message)) crlf += 1;
      else other += 1;
    }
  }

  return {
    result: classify(newFailures.length, baselineFailures.length),
    newFailures,
    baselineFailures,
    baselineBreakdown: { crlf, other },
  };
}

/**
 * Split a task's requiredChecks into runnable checks and unsupported names.
 *
 * @returns {{ checks: string[], unsupported: string[] }}
 */
export function resolveChecks(task) {
  const requested = Array.isArray(task?.requiredChecks) ? task.requiredChecks : [];
  return {
    checks: requested.filter((name) => ALLOWED_CHECKS.includes(name)),
    unsupported: requested.filter((name) => !ALLOWED_CHECKS.includes(name)),
  };
}

/**
 * Run eslint over the whole repository and classify every error.
 *
 * @param {string[]} changedFiles repo-relative paths the run is accountable for
 * @returns {{ name, result, exitCode, newFailures, baselineFailures, files }}
 */
export function runLint(changedFiles = [], cwd = process.cwd()) {
  const owned = new Set(changedFiles.map(normalize));
  let raw = "";
  let exitCode = 0;
  try {
    raw = execFileSync(process.execPath, [eslintBin(cwd), ".", "--format", "json"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // eslint exits non-zero when it finds errors; the JSON is still on stdout.
    raw = error.stdout ?? "";
    exitCode = error.status ?? 1;
  }

  let results;
  try {
    results = JSON.parse(raw);
  } catch {
    return {
      name: "lint",
      result: "NEW_FAILURE",
      exitCode: exitCode || 1,
      newFailures: [{ file: "(eslint)", message: "could not parse eslint JSON output" }],
      baselineFailures: [],
      baselineBreakdown: { crlf: 0, other: 0 },
      files: [],
    };
  }

  return { name: "lint", exitCode, files: [...owned], ...classifyLintResults(results, owned, cwd) };
}

const classify = (newCount, baselineCount) => {
  if (newCount > 0) return "NEW_FAILURE";
  if (baselineCount > 0) return "BASELINE_FAILURE";
  return "PASS";
};

/**
 * Run a single check.
 *
 * typecheck and build have no baseline concept: they pass or they do not.
 * lint is classified against LINT_BASELINE.
 */
export function runCheck(name, changedFiles = [], cwd = process.cwd()) {
  const started = Date.now();
  const stamp = (result) => ({
    ...result,
    command: name === "lint" ? "eslint . --format json" : `npm run ${CHECK_SCRIPTS[name] ?? name}`,
    cwd,
    durationMs: Date.now() - started,
  });

  if (name === "lint") return stamp(runLint(changedFiles, cwd));

  const script = CHECK_SCRIPTS[name];
  if (!script) {
    return stamp({
      name,
      result: "NEW_FAILURE",
      exitCode: -1,
      newFailures: [{ file: "(runner)", message: `unsupported check "${name}"` }],
      baselineFailures: [],
      log: "",
    });
  }

  try {
    // shell: true so npm.cmd resolves on Windows; every argument here is a
    // fixed literal from CHECK_SCRIPTS, never task-supplied input.
    const log = execFileSync("npm", ["run", script], {
      cwd,
      shell: true,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return stamp({
      name,
      result: "PASS",
      exitCode: 0,
      newFailures: [],
      baselineFailures: [],
      log,
    });
  } catch (error) {
    return stamp({
      name,
      result: "NEW_FAILURE",
      exitCode: error.status ?? 1,
      newFailures: [{ file: "(check)", message: `${script} failed` }],
      baselineFailures: [],
      log: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    });
  }
}

/**
 * Run checks in order, stopping at the first NEW_FAILURE.
 * BASELINE_FAILURE does not stop the run — it is recorded and reported.
 *
 * Not called by the dry run: the dry run only reports which checks apply.
 */
export function runChecks(names, changedFiles = [], cwd = process.cwd()) {
  const results = [];
  for (const name of names) {
    const result = runCheck(name, changedFiles, cwd);
    results.push(result);
    if (result.result === "NEW_FAILURE") break;
  }
  return results;
}

/** A run is blocked if any check produced a NEW_FAILURE. */
export const hasNewFailure = (results) => results.some((r) => r.result === "NEW_FAILURE");
