import { createN8nConnector } from "./n8n.mjs";
import { createVercelConnector } from "./vercel.mjs";

/**
 * The SECOND mutation gate, independent of any approval receipt.
 *
 * An approved Class B/C action still performs nothing unless this process was
 * started with mutations explicitly enabled. Both gates must be open — an exact
 * receipt AND this switch — and the default, always, is deny.
 */
export const mutationsEnabled = (env = process.env) => env.ATLAS_ALLOW_MUTATIONS === "1";

export const configuredConnectors = ({ env = process.env, fetchImpl = globalThis.fetch } = {}) => {
  const allowMutations = mutationsEnabled(env);
  return {
    n8n: createN8nConnector({ env, fetchImpl, allowMutations }),
    vercel: createVercelConnector({ env, fetchImpl, allowMutations }),
  };
};

export { createN8nConnector, createVercelConnector };
