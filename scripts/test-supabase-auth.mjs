// Focused compatibility checks for legacy JWT and modern opaque Supabase keys.
// Synthetic values only; no environment variables or network access.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/supabase-auth-test";
execSync(
  `npx tsc api/_lib/supabaseAuth.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { supabaseAuthHeaders } = await import(
  pathToFileURL(path.resolve(outDir, "supabaseAuth.js")).href
);

const legacyKey = "legacyHeader.legacyPayload.legacySignature";
const authOverrides = {
  authorization: "lowercase-must-be-removed",
  AUTHORIZATION: "uppercase-must-be-removed",
  ApiKey: "mixed-case-must-be-removed",
  APIKEY: "uppercase-must-be-removed",
};
const legacy = supabaseAuthHeaders(legacyKey, authOverrides);
assert.equal(legacy.apikey, legacyKey, "legacy key must be sent as apikey");
assert.equal(legacy.Authorization, `Bearer ${legacyKey}`, "legacy JWT must be Bearer");
assert.deepEqual(
  Object.keys(legacy).filter((name) => ["apikey", "authorization"].includes(name.toLowerCase())),
  ["apikey", "Authorization"],
  "legacy auth headers must be helper-controlled regardless of caller casing",
);

const publishableKey = "sb_publishable_synthetic_test_value";
const publishable = supabaseAuthHeaders(publishableKey, authOverrides);
assert.equal(publishable.apikey, publishableKey, "publishable key must be sent as apikey");
assert.ok(!("Authorization" in publishable), "publishable key must not be Bearer");
assert.deepEqual(
  Object.keys(publishable).filter((name) => name.toLowerCase() === "authorization"),
  [],
  "publishable key must remove every caller Authorization casing",
);

const secretKey = "sb_secret_synthetic_test_value";
const secret = supabaseAuthHeaders(secretKey, authOverrides);
assert.equal(secret.apikey, secretKey, "secret key must be sent as apikey");
assert.ok(!("Authorization" in secret), "secret key must not be Bearer");
assert.deepEqual(
  Object.keys(secret).filter((name) => name.toLowerCase() === "authorization"),
  [],
  "secret key must remove every caller Authorization casing",
);

assert.throws(
  () => supabaseAuthHeaders(""),
  (error) =>
    error instanceof Error &&
    error.message === "Supabase API key is not configured." &&
    !error.message.includes("sb_"),
  "empty key must fail without exposing key material",
);
assert.throws(
  () => supabaseAuthHeaders("   "),
  (error) => error instanceof Error && error.message === "Supabase API key is not configured.",
  "whitespace-only key must fail safely",
);

for (const malformed of ["header.payload", "one.two.three.four"]) {
  const headers = supabaseAuthHeaders(malformed);
  assert.equal(headers.apikey, malformed, "malformed JWT-like key must still be sent as apikey");
  assert.ok(!("Authorization" in headers), "malformed JWT-like key must not be Bearer");
}

const extra = supabaseAuthHeaders(secretKey, {
  "Content-Type": "application/json",
  Prefer: "return=representation",
  "x-custom": "preserved",
  Authorization: "must-be-removed",
  authorization: "lowercase-must-also-be-removed",
  ApiKey: "mixed-case-must-be-removed",
  APIKEY: "uppercase-must-be-removed",
});
assert.equal(extra["Content-Type"], "application/json");
assert.equal(extra.Prefer, "return=representation");
assert.equal(extra["x-custom"], "preserved");
assert.deepEqual(
  Object.keys(extra).filter((name) => name.toLowerCase() === "authorization"),
  [],
  "modern keys must remove supplied Bearer auth case-insensitively",
);
assert.deepEqual(
  Object.keys(extra).filter((name) => name.toLowerCase() === "apikey"),
  ["apikey"],
  "the helper-generated apikey must be the only apikey header",
);

console.log("test-supabase-auth: all assertions passed");
