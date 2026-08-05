# Permissions

Three tiers. The identifiers below are the exact strings used in a task's
`permissions` array and in `agent/schemas.mjs` — the prose and the code must not
drift apart.

## Tier 1 — Automatic after task approval

Granted the moment a task is approved. Local, reversible, contained.

| Permission | Meaning |
| --- | --- |
| `read_repository` | Read any file in this repository |
| `plan_workspace` | Calculate an isolated branch name and worktree path |
| `edit_task_workspace` | Edit files inside the task's `allowedPaths` |
| `run_checks` | Run `typecheck`, `lint`, `build` |
| `inspect_local_logs` | Read safe local logs and check output |
| `review_local_diff` | Read the local diff |
| `prepare_reports` | Write run reports under `project/runs/` |

## Tier 2 — Requires explicit approval

Named per task, per action. Never inferred from a Tier 1 grant.

| Permission | Meaning |
| --- | --- |
| `commit` | Create a commit |
| `push` | Push to a remote |
| `pull_request` | Open a pull request |
| `n8n_change` | Modify or publish an n8n workflow |
| `supabase_data_change` | Modify Supabase data |
| `project_rule_update` | Change `AGENTS.md`, `project/*.md` or `agent/**` |
| `merge` | Merge a branch |

## Tier 3 — Critical approval

Explicit, named, human approval every time. Never batched with anything else.

| Permission | Meaning |
| --- | --- |
| `production_deploy` | Deploy to Production |
| `database_schema_change` | Change the database schema |
| `secret_rotation` | Rotate a secret |
| `deletion` | Delete data, files or resources |
| `customer_message` | Send a real message to a real customer |
| `order_or_payment` | Create or alter a real order or payment |
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

## Enforcement

`agent/schemas.mjs` defines the tiers. Anything in Tier 2 or Tier 3 is a
**protected action**.

The dry-run runner **refuses** any task whose `permissions` list contains a
protected action: the run stops immediately with `BLOCKED_PERMISSION` and a
non-zero exit code, before any workspace is planned. Tier 2 and Tier 3 actions
are not executed by this bootstrap at all — a human performs them.

A permission not present in the task's `permissions` array is not granted. An
unknown permission string makes the task invalid.
