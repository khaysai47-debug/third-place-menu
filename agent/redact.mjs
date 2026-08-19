// Secret scrubbing for anything that gets written down.
//
// Orchestration state, evidence and reports are read by humans and kept outside
// the repository for a long time. A connector error message or a check log can
// carry a token; once it is in evidence/*.json it is in a file nobody thinks of
// as a secret store. Everything written by taskstate.mjs and the workers goes
// through here first.
//
// This is a net, not a guarantee: the real defence is that no worker is ever
// handed a credential to begin with.

const PATTERNS = [
  // Provider-style keys: sk-…, ghp_…, xoxb-…
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, "«redacted:key»"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "«redacted:key»"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "«redacted:key»"],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "«redacted:jwt»"],
  // Authorization headers.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 «redacted»"],
  // key = value / "key": "value" for anything that names itself a credential.
  [
    /\b(api[_-]?key|secret|token|password|passwd|pwd|credential|authorization|signature)\b(["']?\s*[=:]\s*["']?)([^\s"',;}]{4,})/gi,
    "$1$2«redacted»",
  ],
];

/**
 * Scrub credential-shaped substrings out of text. Non-strings pass through
 * unchanged so callers can hand it anything.
 */
export function redact(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Deep-scrub every string in a JSON-shaped value. Used on evidence payloads. */
export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]));
  }
  return value;
}

const SECRET_FIELD =
  /^(?:api[_-]?key|secret|token|password|passwd|pwd|authorization|signature|credentialValue)$/i;

/**
 * Fail closed when data crossing into a worker appears to contain a secret.
 * Connectors resolve `secretRef` values inside their own closure; callers pass
 * only the reference name. Redaction remains a final persistence safety net.
 */
export function assertNoSecretValues(value, at = "args") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretValues(item, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && redact(value) !== value) {
      throw new Error(`secret-shaped value is not allowed across the worker boundary at ${at}`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key) && child !== null && child !== undefined && child !== "") {
      throw new Error(`secret-bearing field "${key}" is not allowed across the worker boundary`);
    }
    assertNoSecretValues(child, `${at}.${key}`);
  }
}
