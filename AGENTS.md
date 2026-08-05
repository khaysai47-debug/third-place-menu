# Atlas Development Agent

The Atlas Development Agent is a local, human-supervised development loop for the
Atlas / The Third Place restaurant operations system. It exists to make changes
**proposed, reviewed and evidenced** before a human decides anything irreversible.

This bootstrap contains memory, schemas, permission gates, workspace planning,
check execution and reporting. It does **not** yet execute Claude or Codex as
subprocesses — that comes later, on top of these rules.

## Roles

### Coordinator (`agent/coordinator.mjs`)

Owns the loop. It never writes application code and never talks to a customer.

- Loads and validates the task.
- Enforces approval and permission gates.
- Compares the task's `baseCommit` with the repository HEAD.
- Plans (does not create) an isolated branch and worktree.
- Decides which checks apply.
- Collects evidence and writes the run report.
- Stops the run and escalates. The Coordinator's default answer is "stop".

### Claude Builder

Implements the change inside the task workspace, within `allowedPaths`.

- Works only on an approved task, only within the declared paths.
- Produces a diff plus the evidence for it: check output, reasoning, assumptions.
- Never widens the scope of the task. A newly discovered problem becomes a new
  task, not extra lines in this one.
- Never performs an action from the approval or critical permission tiers.

### Codex Reviewer

Reviews the Builder's diff and evidence against the acceptance criteria.

- Returns a structured verdict: `PASS`, `REVISE` (with specific, actionable
  findings), or `NEEDS_HUMAN`.
- Reviews what the diff does, not what it claims to do.
- Does not edit code. If the Reviewer wants a change, it says so; the Builder
  makes it.

## Communication

Builder and Reviewer exchange structured messages, not prose opinions:

- **Task** — the JSON task file (see `project/TASK_TEMPLATE.md`).
- **Evidence** — diff, check names and exit codes, files touched, assumptions.
- **Verdict** — `PASS` / `REVISE` / `NEEDS_HUMAN`, with findings anchored to a
  file and line.

Every claim must be backed by evidence produced in this run. "It should work" is
not evidence; a passing `typecheck` with its exit code is.

## Draft validation vs. execution

These are two different gates. Do not confuse them.

| | Draft validation | Approved execution |
| --- | --- | --- |
| Entry point | `validate()`, `dryRun()` | `executionPreflight()` |
| Purpose | Is this task well-formed and ready to show a human? | May work begin *right now*? |
| Authorizes work | **Never** | Yes — and only this |
| Ordering | Approval before repository state, so a draft is not reported as `DIRTY_REPOSITORY` | All gates, in order, first failure wins |

**Every approved execution freshly rechecks all six inputs**, in this order:

1. **Task validity** — the task file is re-read from disk and re-validated.
2. **Protected permissions** — re-derived from the file just read.
3. **Task approval** — `approved`, `approvedAt`, `approvedBy`, read fresh.
4. **Expected base commit vs. current HEAD** — read fresh from Git.
5. **Repository cleanliness** — read fresh from Git.
6. **Workspace / worktree state** — `absent`, `registered` or `foreign`. A
   `foreign` path (exists on disk, unknown to Git) is never touched.

**No previous dry-run inspection may authorize a later execution.** A run report
carries `authorizes: false`. Approval can be revoked, HEAD can move, the tree can
get dirty, and a stale worktree can appear between the inspection and the work.
The preflight runs again immediately before work starts, and again after every
pause and resume. See decision D-008.

## Checks and the lint baseline

Checks return `PASS`, `NEW_FAILURE` or `BASELINE_FAILURE`, not a boolean.

- Only `NEW_FAILURE` blocks a run.
- Classification is by **ownership**: errors in files the run changed are new;
  errors in files it never touched are baseline.
- `BASELINE_FAILURE` is the repository's pre-existing debt. Since line-ending
  normalization (2026-08-05, D-012) that is **317 errors, 0 of them line
  endings** — down from 25,677. It stays visible in every report, with the
  `crlf` / `other` breakdown, and is never suppressed.
- Files the run **changed** must lint clean, completely. A CR error in a file the
  agent edited is a `NEW_FAILURE` — the agent wrote that line.
- Repository-wide line-ending normalization is a separate approved maintenance
  task. No task may fix it in passing.

See `project/TEST_MATRIX.md` and decision D-009.

## Pauses

Usage limits, expired credentials and network errors are **recoverable pauses**,
not implementation failures. They consume no implementation or revision round,
the worktree and checkpoint are preserved, and a resume revalidates through the
full execution preflight rather than continuing on trust. The agent never
switches to paid API usage on its own.

States, checkpoint schema and the full rule set: `project/PAUSE_RESUME.md`.

## Loop limits

- **Maximum two planning rounds.** If the plan is not agreed after two, stop with
  `NEEDS_HUMAN`.
- **Maximum two revision rounds.** If the Reviewer still finds blocking issues
  after two revisions, stop with `NEEDS_HUMAN`.
- **Stop on repeated identical failure.** The same check failing the same way
  twice is a signal that the agent does not understand the problem. Stop; do not
  try a third variation.
- **Stop on missing permission.** A task that needs an action it was not granted
  stops immediately as `BLOCKED_PERMISSION`. It never proceeds "partially".
- **`NEEDS_HUMAN` on unresolved disagreement.** Builder and Reviewer do not get
  to out-argue each other. Disagreement escalates.

## Hard rules

- **No uncontrolled self-modification.** The agent does not edit `AGENTS.md`,
  `project/*.md`, `agent/**`, or its own permission model as part of a normal
  task. Changing the rules is itself a task, and it needs explicit approval
  (`project_rule_update`).
- **No irreversible or outward-facing action without the required approval.**
  Specifically: no commit, push, pull request, merge, deployment, Production
  write, database schema change, secret rotation, deletion, customer message,
  order, or payment action. See `project/PERMISSIONS.md` for the tiers.
- **Protected systems are out of scope.** n8n, Supabase, Meta Messenger, Vercel
  configuration, secrets and environment values are not touched by the agent.
- **Secrets are never printed.** Not in logs, not in reports, not in diffs.

## Commands

```
npm run agent:validate -- --task project/tasks/ATLAS-001.json
npm run agent:dry-run  -- --task project/tasks/ATLAS-001.json
npm run agent:test
```

The dry run reads the repository and writes a report under `project/runs/`. It
creates no branch, no worktree, no commit, no push and no deployment.
