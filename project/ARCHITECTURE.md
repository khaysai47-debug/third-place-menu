# Architecture

## Application

| Area | Location | Notes |
| --- | --- | --- |
| Customer menu and app UI | `src/` | React + TypeScript, TanStack Router, Vite |
| Server API | `api/` | Single Vercel function entry point `api/router.ts`, with `api/_lib/*.server.ts` modules behind it |
| Standalone checks | `scripts/` | `node`-run `.mjs` suites, no test framework |
| Documentation | `docs/` | Existing runbooks and contracts |
| Agent memory | `project/` | Project facts, tasks, run reports |
| Agent runner | `agent/` | Coordinator, schemas, workspace planning, checks, reports |

Requests reach Production through the `vercel.json` rewrite
`/api/:path*` → `/api/router?path=:path*`, so the deployed surface is one
function that dispatches internally.

## Messenger flow (as it stands today)

```
Meta Messenger
      │  webhook + signature verification
      ▼
  api/ (Vercel)
      │  sanitized event
      ▼
     n8n  ── Atlas Messenger Webhook Receiver (STAGING), id 5BKEgw3dcsEJoA3X
      │
      ▼
 outbound Messenger send  (button templates, greeting)
```

**Place an Order** creates a secure bot-session link, which hands the customer to
the web app. Session creation currently happens before the greeting is sent,
which is why the greeting is delayed (see `CURRENT_STATE.md`).

## Agent runner

```
agent/cli.mjs           argument parsing, exit codes
      │
      ▼
agent/coordinator.mjs   validate() / dryRun()      — draft, authorizes nothing
                        executionPreflight()       — the ONLY authorizing gate
      ├── agent/schemas.mjs    task schema, permission tiers, run states,
      │                        check results, checkpoint schema
      ├── agent/workspace.mjs  git inspection, proposed branch + worktree state
      ├── agent/checks.mjs     check → npm script, baseline-aware lint
      └── agent/report.mjs     JSON + Markdown run reports

agent/agent.test.mjs    coordinator safety tests (`npm run agent:test`)
```

Every module is read-only with respect to Git. The only thing the runner writes
is a report under `project/runs/`.

`dryRun()` and `executionPreflight()` accept an optional `{ git, runsDir }` seam;
the defaults are always the real repository and `project/runs/`. The seam exists
so the test suite can drive blocking gates — dirty tree, drifted HEAD, foreign
worktree — without creating anything real (D-010).

## Trust boundaries

- **Repository** — the agent may read all of it and edit only a task's
  `allowedPaths`.
- **n8n, Supabase, Meta, Vercel, secrets** — outside the boundary. The agent
  never reads or writes them.
- **Production** — outside the boundary, unconditionally.
