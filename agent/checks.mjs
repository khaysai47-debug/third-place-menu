// Local check runner. Every check maps onto an existing package.json script so
// there is exactly one definition of what "typecheck" means in this repo.
//
// `format` is deliberately absent: `prettier --write` mutates the working tree,
// which a verification step must never do.
//
// Lint is baseline-aware. This repository has a known repository-wide failure —
// files are stored LF and checked out CRLF, so `prettier/prettier` reports
// "Delete `␍`" on essentially every line of every pre-existing file. That debt
// is real and must stay visible, but it is not any single task's fault. See
// project/TEST_MATRIX.md and decision D-009.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ALLOWED_CHECKS } from "./schemas.mjs";

// Node refuses to spawn a Windows .cmd shim without `shell: true`, so eslint is
// invoked through its own JS entry point instead of npx: no shell, no quoting
// hazard, and the JSON report arrives intact.
const ESLINT_BIN = path.join(process.cwd(), "node_modules", "eslint", "bin", "eslint.js");

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

const normalize = (file) => file.replace(/\\/g, "/").replace(/^.*?third-place-menu\//, "");

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
export function classifyLintResults(eslintResults, owned = new Set()) {
  const newFailures = [];
  const baselineFailures = [];
  let crlf = 0;
  let other = 0;

  for (const file of eslintResults) {
    const path = normalize(file.filePath);
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
export function runLint(changedFiles = []) {
  const owned = new Set(changedFiles.map(normalize));
  let raw = "";
  let exitCode = 0;
  try {
    raw = execFileSync(process.execPath, [ESLINT_BIN, ".", "--format", "json"], {
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

  return { name: "lint", exitCode, files: [...owned], ...classifyLintResults(results, owned) };
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
export function runCheck(name, changedFiles = []) {
  if (name === "lint") return runLint(changedFiles);

  const script = CHECK_SCRIPTS[name];
  if (!script) {
    return {
      name,
      result: "NEW_FAILURE",
      exitCode: -1,
      newFailures: [{ file: "(runner)", message: `unsupported check "${name}"` }],
      baselineFailures: [],
    };
  }

  try {
    // shell: true so npm.cmd resolves on Windows; every argument here is a
    // fixed literal from CHECK_SCRIPTS, never task-supplied input.
    execFileSync("npm", ["run", script], { stdio: "inherit", shell: true });
    return { name, result: "PASS", exitCode: 0, newFailures: [], baselineFailures: [] };
  } catch (error) {
    return {
      name,
      result: "NEW_FAILURE",
      exitCode: error.status ?? 1,
      newFailures: [{ file: "(check)", message: `${script} failed` }],
      baselineFailures: [],
    };
  }
}

/**
 * Run checks in order, stopping at the first NEW_FAILURE.
 * BASELINE_FAILURE does not stop the run — it is recorded and reported.
 *
 * Not called by the dry run: the dry run only reports which checks apply.
 */
export function runChecks(names, changedFiles = []) {
  const results = [];
  for (const name of names) {
    const result = runCheck(name, changedFiles);
    results.push(result);
    if (result.result === "NEW_FAILURE") break;
  }
  return results;
}

/** A run is blocked if any check produced a NEW_FAILURE. */
export const hasNewFailure = (results) => results.some((r) => r.result === "NEW_FAILURE");
