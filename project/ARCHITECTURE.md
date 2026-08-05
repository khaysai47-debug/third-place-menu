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
      ├── validate / dry-run ─▶ agent/coordinator.mjs
      │        validate() / dryRun()     — draft, authorizes nothing
      │        executionPreflight()      — the ONLY authorizing gate
      │
      └── run / resume ──────▶ agent/engine.mjs
               runTask() / resumeRun()   — the execution loop
                 ├── agent/workspace.mjs    branch + worktree create, changed
                 │                          files, diff (the only Git writes)
                 ├── agent/prompts.mjs      Builder / revision / Reviewer prompts
                 ├── agent/adapters/claude.mjs   Builder subprocess
                 ├── agent/adapters/codex.mjs    Reviewer subprocess (read-only)
                 ├── agent/scope.mjs        allowedPaths / forbiddenPaths gate
                 ├── agent/checks.mjs       check → npm script, baseline-aware
                 └── agent/runstore.mjs     project/runs/<run-id>/, atomic writes

agent/schemas.mjs       task schema, permission tiers, run states, check
                        results, checkpoint and review validation
agent/report.mjs        flat dry-run reports
agent/agent.test.mjs    coordinator safety tests
agent/engine.test.mjs   engine tests (fake adapters, temporary repositories)
```

### What writes what

| Component | Writes |
| --- | --- |
| `coordinator.mjs` | nothing but a dry-run report |
| `workspace.mjs` | one branch, one worktree, and `git add --intent-to-add` **inside the worktree only** |
| `engine.mjs` | the run directory under `project/runs/` |
| Claude Builder | files inside the worktree, nothing else (no shell) |
| Codex Reviewer | nothing (read-only sandbox) |

No component commits, pushes, merges, tags, deletes a branch with work on it, or
deploys. The main checkout is never modified by a run — the engine tests assert
`git status --short` is still empty and `HEAD` still points at the base commit
after a full loop.

### Isolated worktree

Created at `<repo>-agent-worktrees/<task-id>/`, outside the repository (a path
inside the repo is refused by `assertOutsideRepo`). `node_modules` is linked in
with a junction/symlink rather than reinstalled, so checks can run in the
worktree without a second dependency tree or a network round trip.

### Injection seams

`runTask`/`resumeRun` accept `{ repoRoot, runsRoot, builder, reviewer, runChecks,
git, sleep, now, autoResume, maxRetries, retryMs }`. Defaults are always the real
repository and the real CLIs; the seams exist so the engine tests can drive the
entire loop against temporary repositories with fake adapters — no Claude, no
Codex, no network, no quota.

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
