# Decisions

One entry per decision. Newest last. A decision stays here even when it is later
reversed — the reversal becomes a new entry.

## D-001 — Project memory lives in the repository

**Date:** 2026-08-05
**Decision:** Agent memory (`AGENTS.md`, `project/`) is versioned alongside the
code rather than kept in an external tool.
**Why:** The facts drift with the code. Keeping them in the same commit history
means a reviewer can see the memory and the change that invalidated it together.

## D-002 — Tasks are JSON, documentation is Markdown

**Date:** 2026-08-05
**Decision:** Machine-executed tasks are JSON files in `project/tasks/`.
`project/TASK_TEMPLATE.md` documents the schema for humans.
**Why:** One parser, no front-matter ambiguity, and validation errors that point
at a field name. Markdown stays the human surface.

## D-003 — Approval is a field on the task, not a runtime prompt

**Date:** 2026-08-05
**Decision:** A task carries `approved`, `approvedAt`, `approvedBy`. The runner
reads them; it never asks interactively.
**Why:** Approval must be auditable and reviewable in a diff. An interactive
"yes" leaves no record.

## D-004 — The dry run makes no Git changes at all

**Date:** 2026-08-05
**Decision:** The dry run only *proposes* a branch name and worktree path. It
runs no `git branch`, `git worktree`, `git commit` or `git push`.
**Why:** The first thing to get right in an agent is that a mistake is
recoverable. A run that changes nothing cannot break anything.

## D-005 — `format` is not a check

**Date:** 2026-08-05
**Decision:** The check runner supports `typecheck`, `lint` and `build` only.
`npm run format` is excluded.
**Why:** `prettier --write` mutates files. A verification step that changes the
thing it verifies is not a verification step. Formatting is enforced through
`lint` (eslint-plugin-prettier) instead.

## D-006 — Exit codes: `READY_FOR_APPROVAL` exits 0

**Date:** 2026-08-05
**Decision:** `agent:dry-run` exits 0 for `READY_TO_RUN` and
`READY_FOR_APPROVAL`, and non-zero for every other status.
**Why:** An unapproved task is not an error — it is the expected state of every
task before a human looks at it, and the normal output of drafting one. Errors
(invalid task, blocked permission, base-commit mismatch, dirty repository,
failure) exit non-zero so they break a pipeline. `agent:validate` exits non-zero
only for a structurally invalid task.

## D-007 — Approval is gated before repository state

**Date:** 2026-08-05
**Decision:** An unapproved task reports `READY_FOR_APPROVAL` even when HEAD has
drifted or the tree is dirty.
**Why:** An unapproved task is waiting on a human, not on a clean tree. Reporting
`DIRTY_REPOSITORY` for a draft task would hide the real blocker. The repository
status is still recorded in the report either way.

**Amended 2026-08-05 by D-008:** this ordering applies to *draft validation only*
and never to execution. See below.

## D-008 — Execution revalidates everything, from scratch, every time

**Date:** 2026-08-05
**Decision:** `executionPreflight()` is the only gate that may authorize work. It
re-reads the task file from disk and re-inspects the repository on every call,
and re-checks all six inputs in order: task validity, protected permissions,
approval, HEAD vs. `baseCommit`, working-tree cleanliness, worktree state. No
earlier inspection — including a `READY_TO_RUN` dry run from a minute ago —
authorizes a later execution. Run reports carry `authorizes: false`.
**Why:** Everything the gate checks can change between the inspection and the
work: a human can revoke approval, a colleague can push, a build can dirty the
tree, a stale worktree can be left behind. A gate that trusts a cached verdict is
not a gate. Re-reading is cheap; acting on stale authorization is not.

**Consequence:** the draft path (`dryRun` on an unapproved task) and the
execution path are deliberately separate code paths with different ordering.
Draft: approval before repository state, so a draft is not reported as
`DIRTY_REPOSITORY`. Execution: all gates, no exceptions, first failure wins.
`WORKTREE_CONFLICT` was added for a planned worktree path that exists on disk but
is not a Git-registered worktree — the runner never touches such a path.

## D-009 — Lint is baseline-aware; the CRLF debt stays visible

**Date:** 2026-08-05
**Decision:** Checks return `PASS`, `NEW_FAILURE` or `BASELINE_FAILURE`.
Classification is by **ownership**: an error in a file the run changed is a
`NEW_FAILURE` whatever the rule; an error in a file the run never touched is
`BASELINE_FAILURE`. Only `NEW_FAILURE` blocks a run. The CRLF pattern
(`LINT_BASELINE`) is still identified separately so the report can break the
baseline down into `crlf` and `other`.
**Why ownership rather than rule matching:** the first version matched the CRLF
rule specifically and blamed the run for everything else. Measuring the real
repository disproved that: of 25,677 errors, 25,637 are CRLF and **40 are other
pre-existing errors** (wrapping, `no-control-regex`) across 7 files nobody in
this task touched. A rule-based baseline would have failed every future task on
debt it did not create. ESLint errors are per-file, so "did this run open the
file" is the accurate test for blame.
**Why:** Three bad options were available: fail every task on pre-existing debt
(nothing ever ships), disable the rule (the debt disappears and comes back
worse), or rewrite 25,677 lines inside an unrelated task (an unreviewable diff
that touches every file in the repository). Classifying instead keeps the debt
counted and visible in every run report while still holding each task to
"leave it no worse than you found it".
**Deferred:** repository-wide line-ending normalization is its own approved
maintenance task. Not done in D-009's task, and no line-ending configuration was
changed there.
**Resolved by D-012 (2026-08-05).** The baseline is now 317 errors, 0 of them
line endings.

## D-010 — Coordinator tests use a fake git reader

**Date:** 2026-08-05
**Decision:** `agent/agent.test.mjs` (Node's built-in runner, no dependencies)
drives every gate through an injected `git` reader. `dryRun` and
`executionPreflight` accept `{ git, runsDir }`; the defaults are always the real
repository and `project/runs/`.
**Why:** The gates worth testing are the blocking ones — dirty tree, wrong base
commit, foreign worktree. Producing those states for real would mean creating
commits and worktrees in the user's repository, which is exactly what the agent
must never do. A two-function seam makes all six cases deterministic and leaves
no trace. `--runs-dir` keeps test reports out of `project/runs/`.

## D-011 — Pauses are states, not failures

**Date:** 2026-08-05
**Decision:** Usage limits, expired auth and network errors are recoverable
pause states (`PAUSE_STATES`), paired with a checkpoint schema
(`CHECKPOINT_FIELDS`). A pause consumes no implementation or revision round;
it increments `retryCount` only. Resume revalidates through the full execution
preflight. The agent never switches to paid API usage automatically.
**Why:** A quota reset is not a defect in the work. Counting it as a failed round
would burn the revision budget on an accounting error, and restarting the task
would throw away correct work already done. Schema and rules first, scheduler
later — the rules are what keep a future scheduler from doing something
expensive or destructive. See `project/PAUSE_RESUME.md`.

## D-012 — Line endings pinned to LF by `.gitattributes`

**Date:** 2026-08-05
**Decision:** A `.gitattributes` file pins every text format to `eol=lf`
(`* text=auto eol=lf` plus explicit rules per format), with `*.bat`, `*.cmd` and
`*.ps1` kept at `eol=crlf` because Windows tooling requires it, and image/font
formats marked `binary`. The working tree was converted CRLF → LF for 172 files.
`core.autocrlf=true` remains set locally and is now moot: attributes take
precedence.
**Why:** The repository was *always* stored LF; `core.autocrlf=true` checked it
out as CRLF while Prettier defaults to `endOfLine: "lf"`. That single mismatch
produced 25,637 of 25,677 lint errors and made lint useless as an agent gate.
Attributes fix it at the checkout layer, for every clone and every platform,
rather than depending on each developer's local Git config.
**No content changed.** All 197 non-binary tracked files hash identically to
their index blobs afterwards (`git hash-object` vs `git ls-files -s`), and
`git diff-index HEAD` is empty — committing them would be a no-op. `.prettierrc`
was left alone: Prettier already defaults to LF, so an explicit `endOfLine` entry
would be redundant.
**Not done:** the 317 remaining genuine lint errors were reported, not fixed.
Auto-fixing 315 Prettier errors would reformat 36 files inside a task whose scope
is line endings — exactly the unreviewable diff this decision avoids.

## D-013 — Safety is enforced by process launch, not by instruction

**Date:** 2026-08-05
**Decision:** The Builder runs with `--disallowedTools Bash,WebFetch,WebSearch,
NotebookEdit` and `--permission-mode acceptEdits`; the Reviewer runs with
`--sandbox read-only`. `assertSafeCommand()` in each adapter throws if a
permission-bypass flag ever appears in a constructed command.
**Why:** A prompt that says "do not commit" is a request. A process with no shell
*cannot* commit. Removing Bash from the Builder makes commit, push, merge, deploy
and dependency installation unreachable rather than merely forbidden, and it does
so with one flag instead of a list of prohibitions that must stay in sync with
whatever git subcommands exist. The prompts still state the rules, as a second
layer for a model that somehow gains a shell.
**Cost:** the Builder cannot run the checks itself. That is fine — the
Coordinator runs them and owns the result, which is the honest arrangement
anyway: a Builder that grades its own work is not evidence.

## D-014 — A pause is a pause, even with automatic resume switched off

**Date:** 2026-08-05
**Decision:** With `--no-auto-resume`, a usage-limit or network pause leaves the
run in `PAUSED_*` awaiting `agent:resume`. Only an exhausted retry budget becomes
`NEEDS_HUMAN`. An auth failure is always `PAUSED_AUTH_REQUIRED` and is never
retried on a timer.
**Why:** The first implementation collapsed "no scheduler configured" into
`NEEDS_HUMAN`, which the tests caught. That conflated two different things: a run
waiting for quota (recoverable, resumable, nobody's fault) and a run that has
tried and failed (needs a person). Retrying an auth failure on a timer is worse
than useless — only a human can log in, so the retries just burn the budget
before the human arrives.

## D-015 — Changed files are parsed from NUL-separated porcelain

**Date:** 2026-08-05
**Decision:** `changedFiles()` uses `git status --porcelain=v1 -z
--untracked-files=all` and consumes the origin record after an `R`/`C` entry.
**Why:** The first version trimmed the command output and sliced three characters
off each line. Trimming ate the leading status space of the first entry, so the
first character of that path was lost — `src/feature.ts` became `rc/feature.ts`.
That is not a cosmetic bug: a mangled path does not match `allowedPaths`, so a
perfectly legitimate change was reported as a `SCOPE_VIOLATION` on the second
revision round. `-z` also removes quoting and escaping, so a filename with a
space or a non-ASCII character parses like any other. The engine tests now cover
both the happy path and the multi-round case that exposed it.

## D-016 — The task file is immutable; approval is an external receipt

**Date:** 2026-08-05
**Decision:** Task files carry no approval. `approved`, `approvedAt` and
`approvedBy` are deprecated (warning if present, hard error if `approved: true`).
Consent is a receipt written to `<repo>-agent-state/approvals/<TASK-ID>.json`,
outside the repository, containing `approvalVersion`, `taskId`, `taskFile`,
`taskHash` (SHA-256 over the canonical specification), `baseCommit`, `approvedBy`
and `approvedAt`. `agent:run` verifies it before invoking any model, refusing
with `APPROVAL_MISSING`, `APPROVAL_INVALID` or `APPROVAL_STALE`.
**Why:** Approving by editing a tracked field made the repository dirty, which
the execution preflight then refused as `DIRTY_REPOSITORY`. Committing the edit
to get clean moved HEAD, which broke the `baseCommit` the task named. The old
design made approval and execution mutually exclusive — you could satisfy one
gate or the other, never both. Moving consent outside the repository dissolves
the conflict: approving writes nothing here at all.
**Bonus property:** binding the receipt to a content hash makes approval
*specific*. Widen `allowedPaths` after approving and the hash moves, so the run
stops. Under the old model, editing the task after setting `approved: true` was
silent — the flag stayed true and the agent executed instructions nobody had
read. That was the more dangerous bug of the two.
**Status mapping:** a dry run reports a missing receipt as `READY_FOR_APPROVAL`
(the draft context) while execution reports `APPROVAL_MISSING` (the authorizing
context). Same condition, named for who is asking.

## D-017 — HEAD may lead the base commit by `project/`-only commits

**Date:** 2026-08-05
**Decision:** `baseCommitAcceptable()` accepts HEAD when it equals `baseCommit`,
or when it is a descendant whose every changed file is under `project/`.
Anything else is `BASE_COMMIT_MISMATCH`.
**Why:** Strict `HEAD === baseCommit` is unsatisfiable for a tracked task file.
The task names the current HEAD; committing the task moves HEAD; updating
`baseCommit` to the new HEAD and committing moves it again. The documented flow
"prepare task → commit task → approve" could never complete. The tests caught
this immediately — the temp repository could not construct a state the approve
command would accept.
**Why `project/` specifically:** it is the agent's own memory directory and
contains no application code, so a commit confined to it cannot change what the
Builder would be working on. The worktree still branches from `baseCommit`, so
the code the Builder sees is exactly the code that was approved. Committing one
line of `src/` moves the code and is correctly refused.

## D-018 — Control-plane drift is not product drift

**Date:** 2026-08-19
**Decision:** the safe set D-017 opened for `project/` is now stated explicitly
as `CONTROL_PLANE_PATHS = ["agent/", "project/", "AGENTS.md"]` — exactly the
paths `PERMISSIONS.md` has always called `project_rule_update`. HEAD may lead
`task.baseCommit` by commits confined to that set; one file outside it anywhere
in the range makes the whole range `BASE_COMMIT_MISMATCH`, with no partial
credit. `executionPreflight()` now reports `approvedProductBase`, `runtimeHead`
and `controlPlaneDrift` separately, and the repo worker writes the acceptance
into evidence.
**Why:** ATLAS-005 was approved at `ac5bdc1`, and while it was in flight a real
Agent V2 adapter bug was found and fixed on main (`6159258`, touching only
`agent/adapters/claude.mjs`, `agent/adapters/codex.mjs` and
`agent/engine.test.mjs`). Resuming its preserved worktree then died at
`BASE_COMMIT_MISMATCH` — a task blocked by a fix to the thing running it. Every
alternative was worse: rewriting the approved task, recreating the worktree, or
hand-rebasing product work nobody had reviewed.
**Two things, kept apart:** the CONTROL-PLANE VERSION is which agent runtime the
process is executing, and it may advance freely, because it changes how work is
done and not what the work is. The APPROVED PRODUCT BASE is `task.baseCommit` —
the code a human read, and the commit the worktree branches from. Nothing here
moves it: no rebase, no reset, no stash, no recreated workspace. The product diff
is exactly what it was.
**Why approval is not weakened:** the receipt still binds one task hash to one
product base, and `verifyApproval()` is untouched. Safe agent maintenance grants
no new product scope, because it cannot change what the Builder is looking at.
Product drift still invalidates execution and still waits for a human.
**Why the set stays this small:** every entry is a path whose movement no longer
invalidates approved work. "Docs" is not on it — `docs/` is product. Adding one
needs its own entry here.
