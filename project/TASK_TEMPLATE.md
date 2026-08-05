# Task Template

A task is a JSON file in `project/tasks/<TASK-ID>.json`. This page documents the
schema; `agent/schemas.mjs` enforces it.

## Fields

| Field | Type | Rules |
| --- | --- | --- |
| `taskId` | string | Non-empty. Matches the filename, e.g. `ATLAS-001`. |
| `title` | string | Non-empty. One line. Used to derive the proposed branch name. |
| `objective` | string | Non-empty. What outcome the task achieves. |
| `context` | string | Non-empty. Why now, and what the agent must know that the code does not say. |
| `owner` | string | Non-empty. The human accountable for this task. |
| `riskLevel` | string | One of `low`, `medium`, `high`, `critical`. |
| `baseCommit` | string | Full 40-character SHA the task was written against. |
| `allowedPaths` | string[] | Non-empty. The only paths the Builder may edit. |
| `forbiddenPaths` | string[] | May be empty. Paths that must not change, stated explicitly even when already outside `allowedPaths`. |
| `acceptanceCriteria` | string[] | Non-empty. Each item independently checkable. |
| `requiredChecks` | string[] | Non-empty. Subset of `typecheck`, `lint`, `build`. See `TEST_MATRIX.md`. |
| `permissions` | string[] | May be empty. Identifiers from `PERMISSIONS.md`. A protected permission blocks the dry run. |
| `stoppingRules` | string[] | Non-empty. Conditions under which the agent must stop and escalate. |
| `approved` | boolean | `false` until a human approves. |
| `approvedAt` | string \| null | ISO 8601 timestamp. Required when `approved` is `true`. |
| `approvedBy` | string \| null | Name of the approver. Required when `approved` is `true`. |

## Example

```json
{
  "taskId": "ATLAS-000",
  "title": "Example task",
  "objective": "What this task achieves.",
  "context": "What the agent needs to know.",
  "owner": "Shan Chin",
  "riskLevel": "low",
  "baseCommit": "1c1e8908dc14ce49f0f188d66870447eb0b40a9c",
  "allowedPaths": ["src/components/example/"],
  "forbiddenPaths": ["api/", "docs/"],
  "acceptanceCriteria": ["Something specific and checkable."],
  "requiredChecks": ["typecheck", "lint", "build"],
  "permissions": [
    "read_repository",
    "plan_workspace",
    "edit_task_workspace",
    "run_checks",
    "review_local_diff",
    "prepare_reports"
  ],
  "stoppingRules": ["Stop if a change is needed outside allowedPaths."],
  "approved": false,
  "approvedAt": null,
  "approvedBy": null
}
```

## Usage

```
npm run agent:validate -- --task project/tasks/ATLAS-000.json
npm run agent:dry-run  -- --task project/tasks/ATLAS-000.json
```

`validate` checks the structure only. `dry-run` additionally checks approval,
compares `baseCommit` against HEAD, inspects repository cleanliness, plans a
branch and worktree, resolves the checks, detects protected actions, and writes a
report to `project/runs/`.

## Executing an approved task

```
npm run agent:run    -- --task project/tasks/ATLAS-000.json
npm run agent:resume -- --run run-20260805T101112Z-ATLAS-000
```

`agent:run` **requires** `approved: true` with `approvedAt` and `approvedBy`. It
re-validates everything from scratch — a passing dry run authorizes nothing — and
refuses before any model is invoked if the task is unapproved, the base commit
has moved, the main repository is dirty, a protected permission is requested, or
the task's branch or worktree already exists.

Scoping advice that matters in practice:

- **`allowedPaths` is enforced, not advisory.** A Builder edit outside it ends
  the run at `SCOPE_VIOLATION` before the Reviewer is called.
- **Claiming a file means owning its lint debt.** 317 pre-existing errors sit in
  36 files (see `TEST_MATRIX.md`); if `allowedPaths` covers one of them, the run
  will be blocked by failures the task did not create. Check the list first.
- **`requiredChecks` runs inside the worktree**, not the main checkout.
