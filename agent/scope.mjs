// Scope enforcement: did the Builder stay inside the paths the task authorized?
//
// Pure functions over a list of changed paths, so the rule is testable without
// a repository. A task's allowedPaths/forbiddenPaths are repo-relative prefixes;
// a trailing slash means "this directory", anything else matches the exact file
// or that prefix followed by a slash.

const normalize = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/** Does `file` fall under the prefix `rule`? */
export function matchesPath(file, rule) {
  const f = normalize(file);
  const r = normalize(rule).replace(/\/+$/, "");
  if (r === "" || r === ".") return true;
  return f === r || f.startsWith(`${r}/`);
}

/**
 * Files a run must never produce even inside allowedPaths: build output and
 * dependency trees. A Builder that emits these is misbehaving, not working.
 */
export const UNEXPECTED_PATTERNS = [
  "node_modules/",
  "dist/",
  ".output/",
  ".vinxi/",
  ".vercel/",
  ".git/",
];

/**
 * Check every changed path against the task's scope.
 *
 * @param {string[]} files          repo-relative paths the Builder changed
 * @param {{allowedPaths: string[], forbiddenPaths: string[]}} task
 * @returns {{ ok, outsideAllowed, forbidden, unexpected, violations }}
 */
export function checkScope(files, task) {
  const allowed = task?.allowedPaths ?? [];
  const forbidden = task?.forbiddenPaths ?? [];

  const outsideAllowed = files.filter((f) => !allowed.some((rule) => matchesPath(f, rule)));
  const forbiddenHits = files.filter((f) => forbidden.some((rule) => matchesPath(f, rule)));
  const unexpected = files.filter((f) => UNEXPECTED_PATTERNS.some((rule) => matchesPath(f, rule)));

  const violations = [
    ...outsideAllowed.map((file) => ({ file, reason: "outside allowedPaths" })),
    ...forbiddenHits.map((file) => ({ file, reason: "matches forbiddenPaths" })),
    ...unexpected.map((file) => ({ file, reason: "unexpected generated file" })),
  ];

  return {
    ok: violations.length === 0,
    outsideAllowed,
    forbidden: forbiddenHits,
    unexpected,
    violations,
  };
}
