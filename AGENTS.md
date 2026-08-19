# Atlas Development Agent

The Atlas Development Agent is a local, human-supervised development loop for the
Atlas / The Third Place restaurant operations system. It exists to make changes
**proposed, reviewed and evidenced** before a human decides anything irreversible.

The local execution loop is implemented: an approved task runs in an isolated Git
worktree, the Claude Builder implements it, the checks run, the Codex Reviewer
judges the diff independently, and at most two revision rounds follow. The run
**stops before commit, push, pull request, merge and deployment** — always. What
a human receives is a preserved worktree, a diff and a report.

## The loop

```
approved task
   │  executionPreflight()  — fresh, every time; refuses before any model runs
   ▼
isolated worktree (branch from the approved base commit, outside the repo)
   │
   ▼
Claude Builder  ──▶  scope gate  ──▶  checks  ──▶  Codex Reviewer
   ▲                     │              │              │
   │                  violation      NEW_FAILURE     REVISE
   │                     │              │              │
   └──── at most 2 revision rounds ◀────┴──────────────┘
                         │
                         ▼
        final report + preserved worktree + diff.patch
                   STOP. A human decides.
```

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

Usage limits, expired credentials, network errors and **a spent Builder turn
budget** are **recoverable pauses**, not implementation failures. They consume no
implementation or revision round, the worktree and checkpoint are preserved, and
a resume revalidates through the full execution preflight rather than continuing
on trust. The agent never switches to paid API usage on its own.

`PAUSED_BUILDER_BUDGET` exists because of ATLAS-004. That run ended
`error_max_turns`, was recorded as `FAILED`, and its worktree was nearly thrown
away — the implementation in it was correct, passed review, and shipped as
`f42d5d0`. **A failed Builder invocation is not a failed task.** A turn limit is
the clock running out mid-sentence, so the run pauses and the resume continues in
the same worktree, with the same session, told explicitly to inspect what is
already there before writing anything.

States, checkpoint schema and the full rule set: `project/PAUSE_RESUME.md`.

## Model adapter boundaries

Neither model is trusted to obey an instruction it could ignore. The boundary is
enforced by how the process is launched.

| | Claude Builder | Codex Reviewer |
| --- | --- | --- |
| Adapter | `agent/adapters/claude.mjs` | `agent/adapters/codex.mjs` |
| Mode | `--print` (non-interactive), `--output-format json` | `codex exec`, `--output-last-message` |
| Can edit files | **Yes**, inside the worktree only | **No** — `--sandbox read-only` |
| Can run a shell | **No** — `--disallowedTools Bash,…` | No |
| Permission mode | `acceptEdits` (never `bypassPermissions`) | n/a |
| cwd | the isolated worktree | the isolated worktree |
| Bounded by | `--max-turns`, wall-clock timeout | wall-clock timeout |
| Output contract | fenced ```json `{summary, filesChanged, notes}` | fenced ```json `{verdict, summary, findings[]}` |

Consequences worth stating plainly:

- **The Builder has no shell**, so it cannot run `git` at all. Commit, push,
  merge and deploy are not "forbidden by policy" — they are unreachable.
- **The Reviewer cannot write**, so a review can never quietly become an edit.
- **`--dangerously-skip-permissions` is never used.** `assertSafeCommand()` in
  each adapter throws if such a flag ever appears in a constructed command.
- **Malformed output is rejected, never guessed at.** An unreadable review
  becomes `NEEDS_HUMAN`; it can never become a PASS.
- The Coordinator never edits application code. Implementation belongs to the
  Builder, judgement to the Reviewer, and the decision to a human.

## Loop limits

These are the **tactical** limits, inside one execution run (`agent:run`). The
V2 orchestrator adds a **strategic** loop above them, with its own budget — see
"V2 orchestration" below. Neither replaces the other: a run still stops after two
revisions; the orchestrator decides whether a further attempt would be learning
something or repeating itself.

- **Maximum two planning rounds.** If the plan is not agreed after two, stop with
  `NEEDS_HUMAN`.
- **Maximum two revision rounds.** If the Reviewer still finds blocking issues
  after two revisions, stop with `NEEDS_HUMAN`.
- **A scope violation is not iterated on.** Writing outside `allowedPaths` or
  inside `forbiddenPaths` ends the run at `SCOPE_VIOLATION` immediately, before
  the Reviewer is ever called. It is a boundary breach, not a quality problem.
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

## V2 orchestration

V1 owns **one Builder invocation**. V2 owns a **goal**, and stays responsible for
it across as many worker steps as the goal survives — which is what stops the
human being the message bus between Claude, Codex, n8n, Vercel and the terminal.

```
orchestrator  owns the goal, the budget and the state. Routes; never implements.
  ├── repo    the whole V1 engine: worktree, Builder, checks, Reviewer, diff
  ├── codex   independent read-only review, and the policy for when it is needed
  ├── n8n     inspect / validate / propose. apply + publish are Class B.
  └── vercel  inspect deployments, logs, config PRESENCE. deploy is Class C.
```

Rules that matter:

- **Inspect before modify.** Every goal starts with a read-only preflight, and an
  external blocker is investigated before anything is proposed.
- **Route by the first proven failing boundary.** An n8n problem goes to the n8n
  worker. The repo worker has no capability that touches an external system, so
  "make the repo worker do it" is not available and AGENTS.md never has to bend.
- **Progress, not counting.** A different blocker continues; the same blocker
  with new evidence continues; the same failure twice with nothing new escalates.
  Bounded by 30 total steps and 5 attempts per worker.
- **Class B/C actions are queued, never performed** — commit, push, publish,
  deploy, production config. There is no code path in the orchestrator that
  performs one.
- **A goal is not complete because it compiled.** Criteria with no automatic
  verifier are marked `manual_verification_required`; a human records the
  verification with `agent:verify`.
- **No connector means `not_available`**, never a simulated success. The n8n and
  Vercel read-only connectors auto-wire when their required environment
  configuration exists, so read-only inspection runs through the real
  worker/connector path; without that configuration every read answers
  `not_available` rather than guessing.
- **External mutations are default-deny.** A protected n8n or Vercel action needs
  BOTH an exact action-specific approval receipt (`agent:approve-action`, bound
  to the task, action, target and artefact hashes) AND explicit runtime mutation
  enablement. Either gate closed means nothing is performed. See
  `project/PERMISSIONS.md`.

State lives outside the repository at
`<repo>-agent-state/task-state/<TASK-ID>/` (`state.json`, `checkpoints/`,
`evidence/`, `final-report.md`), written atomically.

Guardrails carried between tasks: `agent/lessons.json`, loaded at task start and
handed to the Builder on resume.

## Commands

```
npm run agent:validate -- --task project/tasks/<TASK>.json   # structure only
npm run agent:dry-run  -- --task project/tasks/<TASK>.json   # inspect, authorize nothing
npm run agent:approve  -- --task project/tasks/<TASK>.json --by "Your Name"
npm run agent:run      -- --task project/tasks/<TASK>.json   # execute an APPROVED task (V1)
npm run agent:resume   -- --run <RUN_ID>                     # continue a paused run (V1)
npm run agent:test                                           # all agent tests
npm run agent:test:engine                                    # engine tests only
npm run agent:test:orchestrator                              # V2 orchestration tests

npm run agent:orchestrate -- --task project/tasks/<TASK>.json  # V2: own the goal
npm run agent:resume      -- --task <TASK-ID>                  # V2: continue that goal
npm run agent:status      -- --task <TASK-ID>                  # one consolidated block
npm run agent:report      -- --task <TASK-ID>                  # the final report
npm run agent:verify      -- --task <TASK-ID> --criteria C3,C4 --by "Your Name"
```

`orchestrate` and `resume --task` are the same call: stored state decides whether
it is a first run or a continuation, so a goal can never end up with two
worktrees. `run` and `resume --run` are unchanged V1.

Useful flags: `--runs-dir <dir>` (keep reports out of `project/runs`),
`--state-dir <dir>` (where approval receipts live), `--state-root <dir>` (the
external state root, for orchestration state), `--no-auto-resume` (pause instead
of scheduling a retry), `--max-retries <n>`, `--retry-ms <ms>`.

Approval receipts default to `<repo>-agent-state/approvals/`, outside the
repository; `ATLAS_AGENT_STATE_DIR` overrides the root.

### Task approval flow

The task file is an **immutable specification**. It says what should be done; it
never says "yes, do it". Approval is a separate **receipt**, written outside the
repository, that binds one named human to one exact task content at one exact
base commit.

```
1. task prepared      edit project/tasks/<TASK>.json, baseCommit = current HEAD
2. task committed     commit it — a project/-only commit
3. clean repository   git status --short is empty
4. approval receipt   npm run agent:approve -- --task <file> --by "Your Name"
5. execution          npm run agent:run -- --task <file>
6. human decision     read the report, inspect the worktree, decide whether to
                      commit. The agent never does.
```

Why external? Approving by editing a tracked field made the repository dirty,
and committing that edit moved HEAD, which broke the very `baseCommit` the task
named. A receipt outside the repository changes nothing here: no dirty tree, no
new commit, no moved HEAD. See decision D-016.

Change one word of the task after approving and its SHA-256 moves, so the
receipt no longer describes it and the run is refused as `APPROVAL_STALE`.
Approval is consent to a specific thing, not a standing permission.

Step 2 moves HEAD past the `baseCommit` the task names. HEAD may be ahead of the
base **only** when every commit between them touches `project/` alone — the
agent's own memory directory, which holds no application code. Committing a task
specification therefore cannot invalidate the base it names; committing a line of
`src/` does. Without that rule the sequence above could never be satisfied
(D-017).

### Where a run leaves things

```
project/runs/<run-id>/
  run.json            live state and notification log
  checkpoint.json     what a resume needs
  task-snapshot.json  the task exactly as approved
  builder/            raw Builder stdout/stderr per round
  reviewer/           raw Reviewer output per round
  checks/             per-check logs
  diff.patch          the full unified diff
  final-report.md     the human-readable outcome
```

The worktree lives at `<repo>-agent-worktrees/<task-id>/`, outside the
repository, and is **preserved** after the run — including after a pause or a
failure — so a human can inspect it. Nothing is cleaned up automatically.

The dry run reads the repository and writes a report under `project/runs/`. It
creates no branch, no worktree, no commit, no push and no deployment.
