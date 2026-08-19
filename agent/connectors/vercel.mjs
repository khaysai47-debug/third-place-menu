import { redact } from "../redact.mjs";
import { BOUNDARIES } from "../workers/contract.mjs";
import { createJsonClient, requireMutations } from "./http.mjs";

export function createVercelConnector({
  env = process.env,
  fetchImpl = globalThis.fetch,
  token = env.VERCEL_TOKEN,
  projectId = env.VERCEL_PROJECT_ID,
  teamId = env.VERCEL_TEAM_ID ?? env.VERCEL_ORG_ID,
  allowMutations = false,
} = {}) {
  if (!token || !projectId) return null;
  const request = createJsonClient({
    baseUrl: "https://api.vercel.com",
    headers: { Authorization: `Bearer ${token}` },
    fetchImpl,
  });
  const team = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";

  return {
    approvalTarget: { service: "vercel", projectId, teamId: teamId ?? null },
    async inspect_deployments({ limit = 10 } = {}) {
      const body = await request(
        `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${Math.min(Number(limit) || 10, 20)}${team}`,
      );
      const deployments = (body?.deployments ?? []).map((item) => ({
        id: item.uid ?? item.id,
        name: item.name,
        url: item.url,
        state: item.state ?? item.readyState,
        target: item.target ?? null,
        createdAt: item.createdAt ?? item.created,
      }));
      return {
        ok: true,
        summary: `found ${deployments.length} Vercel deployment(s)`,
        verifies: [BOUNDARIES.vercelDeployment],
        data: { deployments },
      };
    },

    async inspect_logs({ deploymentId, limit = 100 }) {
      if (!deploymentId) throw new Error("deploymentId is required");
      const suffix = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
      const events =
        (await request(
          `/v3/deployments/${encodeURIComponent(deploymentId)}/events?limit=${Math.min(Number(limit) || 100, 500)}${suffix}`,
        )) ?? [];
      const logs = events.map((event) => ({
        type: event.type,
        created: event.created,
        text: redact(event.payload?.text ?? event.text ?? ""),
        statusCode: event.payload?.statusCode ?? event.statusCode ?? null,
      }));
      return {
        ok: true,
        summary: `read ${logs.length} sanitized log event(s) for ${deploymentId}`,
        data: { deploymentId, logs },
      };
    },

    async inspect_config({ requiredKeys = [] } = {}) {
      const body = await request(`/v9/projects/${encodeURIComponent(projectId)}/env${teamQuery}`);
      const keys = (body?.envs ?? []).map((item) => item.key).filter(Boolean);
      const present = Object.fromEntries(requiredKeys.map((key) => [key, keys.includes(key)]));
      return {
        ok: Object.values(present).every(Boolean),
        summary: `checked presence of ${requiredKeys.length} Vercel env key(s); values were not requested or returned`,
        verifies: [BOUNDARIES.vercelConfig],
        data: { projectId, present, configuredKeys: keys.sort() },
      };
    },

    async apply_preview_config({ artifact }) {
      requireMutations(allowMutations, "vercel.apply_preview_config");
      if (!artifact?.key || !("value" in artifact))
        throw new Error("artifact.key and non-secret artifact.value are required");
      const created = await request(
        `/v10/projects/${encodeURIComponent(projectId)}/env${teamQuery}`,
        {
          method: "POST",
          body: { key: artifact.key, value: artifact.value, type: "plain", target: ["preview"] },
        },
      );
      return {
        ok: true,
        summary: `created preview configuration ${artifact.key}`,
        data: {
          id: created?.created?.id ?? created?.id ?? null,
          key: artifact.key,
          target: "preview",
        },
      };
    },

    async deploy_production({ artifact }) {
      requireMutations(allowMutations, "vercel.deploy_production");
      if (!artifact || typeof artifact !== "object")
        throw new Error("deployment artifact is required");
      const deployment = await request(`/v13/deployments${teamQuery}`, {
        method: "POST",
        body: { ...artifact, project: projectId, target: "production" },
      });
      return {
        ok: true,
        summary: `created production deployment ${deployment.id ?? deployment.uid}`,
        data: {
          id: deployment.id ?? deployment.uid,
          url: deployment.url ?? null,
          readyState: deployment.readyState ?? null,
        },
      };
    },

    async set_production_env({ artifact }) {
      requireMutations(allowMutations, "vercel.set_production_env");
      if (!artifact?.key || !artifact?.secretRef)
        throw new Error("artifact.key and artifact.secretRef are required");
      const secretValue = env[artifact.secretRef];
      if (!secretValue)
        throw new Error(`connector secret reference ${artifact.secretRef} is unavailable`);
      const created = await request(
        `/v10/projects/${encodeURIComponent(projectId)}/env${teamQuery}`,
        {
          method: "POST",
          body: {
            key: artifact.key,
            value: secretValue,
            type: "encrypted",
            target: ["production"],
          },
        },
      );
      return {
        ok: true,
        summary: `created production env key ${artifact.key}`,
        data: {
          id: created?.created?.id ?? created?.id ?? null,
          key: artifact.key,
          target: "production",
        },
      };
    },
  };
}
