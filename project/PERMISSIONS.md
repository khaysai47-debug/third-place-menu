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

## Enforcement

`agent/schemas.mjs` defines the tiers. Anything in Tier 2 or Tier 3 is a
**protected action**.

The dry-run runner **refuses** any task whose `permissions` list contains a
protected action: the run stops immediately with `BLOCKED_PERMISSION` and a
non-zero exit code, before any workspace is planned. Tier 2 and Tier 3 actions
are not executed by this bootstrap at all — a human performs them.

A permission not present in the task's `permissions` array is not granted. An
unknown permission string makes the task invalid.
