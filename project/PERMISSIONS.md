# Permissions

Three tiers. The identifiers below are the exact strings used in a task's
`permissions` array and in `agent/schemas.mjs` — the prose and the code must not
drift apart.

## Tier 1 — Automatic after task approval

Granted the moment a task is approved. Local, reversible, contained.

| Permission                | Meaning                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_repository`         | Read any file in this repository                                                                                                                                                                   |
| `plan_workspace`          | Calculate an isolated branch name and worktree path                                                                                                                                                |
| `edit_task_workspace`     | Edit files inside the task's `allowedPaths`                                                                                                                                                        |
| `run_checks`              | Run `typecheck`, `lint`, `build`                                                                                                                                                                   |
| `inspect_local_logs`      | Read safe local logs and check output                                                                                                                                                              |
| `review_local_diff`       | Read the local diff                                                                                                                                                                                |
| `prepare_reports`         | Write run reports under `project/runs/`                                                                                                                                                            |
| `inspect_external_system` | **Read-only** inspection of an external system through a configured connector: an n8n execution, a Vercel deployment log, whether a required env var is _present_. Never its value, never a write. |

`inspect_external_system` must be listed explicitly in a task's `permissions` —
unlike the other Tier 1 entries it is not implied by approval, and a worker
refuses the read without it (`not_permitted`). V2.1 auto-wires read-only n8n and
Vercel connectors only when their required environment configuration exists;
otherwise every read answers `not_available` rather than guessing.

## Tier 2 — Requires explicit approval

Named per task, per action. Never inferred from a Tier 1 grant.

| Permission             | Meaning                                          |
| ---------------------- | ------------------------------------------------ |
| `commit`               | Create a commit                                  |
| `push`                 | Push to a remote                                 |
| `pull_request`         | Open a pull request                              |
| `n8n_change`           | Modify or publish an n8n workflow                |
| `supabase_data_change` | Modify Supabase data                             |
| `project_rule_update`  | Change `AGENTS.md`, `project/*.md` or `agent/**` |
| `merge`                | Merge a branch                                   |

## Tier 3 — Critical approval

Explicit, named, human approval every time. Never batched with anything else.

| Permission                      | Meaning                                 |
| ------------------------------- | --------------------------------------- |
| `production_deploy`             | Deploy to Production                    |
| `database_schema_change`        | Change the database schema              |
| `secret_rotation`               | Rotate a secret                         |
| `deletion`                      | Delete data, files or resources         |
| `customer_message`              | Send a real message to a real customer  |
| `order_or_payment`              | Create or alter a real order or payment |
| `destructive_production_action` | Any other destructive Production action |

## How approval is granted

Approval is **not** a field in a tracked file. It is a receipt written outside
the repository by `npm run agent:approve -- --task <file> --by "Your Name"`,
binding one named human to one exact task content (SHA-256) at one exact base
commit.

- Approving changes nothing in the repository — no dirty tree, no commit, no
  moved HEAD.
- Editing the task after approval invalidates the receipt (`APPROVAL_STALE`).
- A task file carrying `approved: true` is a validation **error**; it authorizes
  nothing and must not look as though it does.
- Receipts contain no secrets. They live in `<repo>-agent-state/approvals/`,
  overridable with `--state-dir` or `ATLAS_AGENT_STATE_DIR`.

`agent:approve` itself is Tier 1: it reads the repository and writes one file
outside it. It creates no branch, no worktree, no commit, and invokes no model.
It refuses to approve a task that requests any Tier 2 or Tier 3 permission —
those need their own separate human decision, not this command.

## What `agent:run` does automatically

Under Tier 1, and only after a fresh preflight passes, an execution run may:

- create **one** task branch from the approved base commit
- create **one** isolated worktree outside the repository, and link `node_modules`
- invoke the Claude Builder inside that worktree, with no shell access
- run `typecheck` / `lint` / `build` in that worktree
- run `git add --intent-to-add` **inside the worktree only**, so untracked files
  appear in the diff (no content is staged, and the main index is never touched)
- invoke the Codex Reviewer read-only
- write the run directory under `project/runs/<run-id>/`

It may not, and structurally cannot: commit, push, open a pull request, merge,
tag, deploy, delete a branch that has work on it, touch the main working tree, or
reach n8n, Supabase, Meta Messenger, Vercel or any secret.

The Builder is launched with `--disallowedTools Bash,…`, so it has no shell and
therefore no `git`. The Reviewer is launched with `--sandbox read-only`. These are
process-level guarantees, not instructions a model may choose to follow.

## Action classes (V2 orchestration)

The orchestrator classifies every **worker capability**, not just every task
permission. The class is derived from the tier above, so there is one vocabulary
rather than two:

| Class | Meaning                                                                                                                 | Derived from | Performed automatically?    |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------- |
| **A** | Read-only or isolated: inspect, typecheck, lint, build, edit a worktree, review                                         | Tier 1       | Yes, after approval         |
| **B** | Change-set approval: commit, push, publish an n8n draft, non-secret external config                                     | Tier 2       | **No** — queued for a human |
| **C** | High-risk: production deploy, production env/secret change, schema migration, deletion, customer message, order/payment | Tier 3       | **No** — queued for a human |

A capability that names no permission, or an unrecognised one, is Class **C**.
If unsure, require approval.

Class B and C actions are described, queued into `approvalsPending` and reported.
V2.1 gives each queue entry an immutable action request that hashes the task,
worker, action, target and artefact. `agent:approve-action` can record a separate
named receipt for that exact request; changing the target or artefact invalidates
it. The default runtime still contains no enabled connector mutation path, in
keeping with `AGENTS.md`. A future rule/host change would need separate approval
before an action receipt could authorize execution.

Credentials belong to connectors. Workers pass public identifiers, proposed
artefacts and `secretRef` names only. Prompts, orchestration state, evidence and
reports never receive credential or secret values; persisted output is redacted
again as a final safety net.

## Enforcement

`agent/schemas.mjs` defines the tiers. Anything in Tier 2 or Tier 3 is a
**protected action**.

The dry-run runner **refuses** any task whose `permissions` list contains a
protected action: the run stops immediately with `BLOCKED_PERMISSION` and a
non-zero exit code, before any workspace is planned. Tier 2 and Tier 3 actions
are not executed by this bootstrap at all — a human performs them.

A permission not present in the task's `permissions` array is not granted. An
unknown permission string makes the task invalid.
