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

## Optional V2 fields

Every field below is optional and defaulted. **A V1 task file needs no changes**
— ATLAS-001…004 orchestrate unmodified — so add one only when the default is
wrong for that task.

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `goal` | string | `objective` | One sentence the orchestrator stays responsible for. |
| `successCriteria` | object[] | derived from `acceptanceCriteria` | `{ id?, text, verifiedBy? }`. `verifiedBy` names the boundary that proves it, e.g. `repo.checks.typecheck`, `review.codex`, `n8n.execution`. Omit it and the criterion is a human's to verify. |
| `budget` | object | `{ maxTotalSteps: 30, maxSameFailureWithoutNewEvidence: 2, maxPerWorkerAttempts: 5 }` | The strategic loop's limits. |
| `reviewPolicy` | object | see `agent/workers/codex.mjs` | Which changed paths require an independent Codex review. |
| `systems` | string[] | `[]` | Systems this goal touches (`repo`, `n8n`, `vercel`) — used to select relevant lessons. |
| `systemTargets` | object | `{}` | Per-worker **public, non-secret** target arguments the router forwards to an external worker, e.g. `systemTargets.n8n.workflowId`, or the public Vercel arguments the connector accepts (`limit`, `requiredKeys`, `deploymentId`). |

**`systemTargets` carries identifiers, never credentials.** A token, API key,
password, authorization header or any other secret value placed there is refused
before the worker is called, not redacted afterwards. Credentials reach an
external system only from the connector's own environment.

Without `successCriteria`, each `acceptanceCriteria` entry becomes a criterion
and a small table decides whether the agent can prove it: mentions of typecheck,
lint, build or a Codex review get an automatic verifier, and **everything else is
marked `manual_verification_required`** rather than assumed. That is deliberate:
"a customer taps the button and gets the right reply" is not something a
typecheck can prove. A human records it with
`npm run agent:verify -- --task <ID> --criteria C4 --by "Your Name"`.

**There are no approval fields.** A task file is a pure specification: it says
what should be done, never "yes, do it". `approved`, `approvedAt` and
`approvedBy` are deprecated — present-but-false is tolerated with a warning,
and `approved: true` is a validation **error**, because a file that claims to be
approved would read as authorization to a human while meaning nothing to the
runner. Consent lives in an external receipt; see below and decision D-016.

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
  "stoppingRules": ["Stop if a change is needed outside allowedPaths."]
}
```

## Approval: an external receipt

Approving a task **does not touch this repository**. It writes one JSON file
outside it:

```
D:\Projects\third-place-menu-agent-state\approvals\<TASK-ID>.json
```

```json
{
  "approvalVersion": 1,
  "taskId": "ATLAS-000",
  "taskFile": "project/tasks/ATLAS-000.json",
  "taskHash": "sha256:1f3a…",
  "baseCommit": "6440d740475b73c0a1258e8458a0689cf91e0f3a",
  "approvedBy": "Sai Sai Khay",
  "approvedAt": "2026-08-05T10:42:11.004Z"
}
```

`taskHash` is SHA-256 over the canonical task specification — keys sorted,
formatting irrelevant, deprecated approval fields excluded. So reindenting the
file is harmless, and changing one word of the objective is not: the hash moves,
the receipt no longer describes the task, and execution is refused as
`APPROVAL_STALE`. **Approval is consent to a specific thing, not a standing
permission.**

The receipt holds no secrets: a task id, a path, a hash, a commit, a name and a
timestamp.

Override the location with `--state-dir <path>` or `ATLAS_AGENT_STATE_DIR`.

## The required sequence

```
1. task prepared      edit project/tasks/<TASK>.json, baseCommit = current HEAD
2. task committed     commit it (a project/-only commit)
3. clean repository   git status --short is empty
4. approval receipt   npm run agent:approve -- --task <file> --by "Your Name"
5. execution          npm run agent:run -- --task <file>
```

Step 2 moves HEAD past the `baseCommit` the task names. That is expected and
allowed: HEAD may be ahead of `baseCommit` **only** when every commit between
them touches `project/` alone. Committing a task specification therefore cannot
invalidate the base it names, while committing a line of `src/` does. Without
that rule the sequence above would be impossible — see decision D-017.

## Usage

```
npm run agent:validate -- --task project/tasks/ATLAS-000.json
npm run agent:dry-run  -- --task project/tasks/ATLAS-000.json
npm run agent:approve  -- --task project/tasks/ATLAS-000.json --by "Your Name"
npm run agent:run      -- --task project/tasks/ATLAS-000.json
```

`approve` refuses unless the task is valid, requests no protected operation, has
a named approver, sits on an acceptable base commit and finds the working tree
clean — with one documented exemption: untracked files under `project/runs/`
(dry-run reports) do not block, because making people delete run artifacts before
approving would teach them to ignore the cleanliness check.

`validate` checks the structure only. `dry-run` additionally checks approval,
compares `baseCommit` against HEAD, inspects repository cleanliness, plans a
branch and worktree, resolves the checks, detects protected actions, and writes a
report to `project/runs/`.

## Executing an approved task

```
npm run agent:run    -- --task project/tasks/ATLAS-000.json
npm run agent:resume -- --run run-20260805T101112Z-ATLAS-000
```

`agent:run` **requires a valid external approval receipt**. It re-verifies
everything from scratch — a passing dry run authorizes nothing — and refuses
before any model is invoked when:

| Condition | Status |
| --- | --- |
| no receipt | `APPROVAL_MISSING` |
| receipt unreadable, malformed, unknown version, wrong task id, missing approver, invalid or future timestamp | `APPROVAL_INVALID` |
| task edited after approval, or approved against a different base | `APPROVAL_STALE` |
| base commit moved with non-`project/` changes | `BASE_COMMIT_MISMATCH` |
| main repository dirty | `DIRTY_REPOSITORY` |
| protected permission requested | `BLOCKED_PERMISSION` |
| branch or worktree already exists | `BRANCH_EXISTS` / `WORKTREE_CONFLICT` |

A dry run reports a missing receipt as `READY_FOR_APPROVAL` rather than
`APPROVAL_MISSING` — the same condition, named for the draft context.

Scoping advice that matters in practice:

- **`allowedPaths` is enforced, not advisory.** A Builder edit outside it ends
  the run at `SCOPE_VIOLATION` before the Reviewer is called.
- **Claiming a file means owning its lint debt.** 317 pre-existing errors sit in
  36 files (see `TEST_MATRIX.md`); if `allowedPaths` covers one of them, the run
  will be blocked by failures the task did not create. Check the list first.
- **`requiredChecks` runs inside the worktree**, not the main checkout.
