import { redact } from "../redact.mjs";

export function createJsonClient({ baseUrl, headers, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const root = String(baseUrl).replace(/\/+$/, "");
  return async function request(route, { method = "GET", body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${root}${route}`, {
        method,
        headers: {
          Accept: "application/json",
          ...headers,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new Error(redact(`network request failed: ${error.message}`));
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: redact(text.slice(0, 500)) };
      }
    }
    if (!response.ok) {
      const message = data?.message ?? data?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(redact(`HTTP ${response.status}: ${message}`));
    }
    return data;
  };
}

export function requireMutations(allowMutations, action) {
  if (!allowMutations) {
    throw new Error(`${action} is disabled in the default Atlas runtime`);
  }
}
