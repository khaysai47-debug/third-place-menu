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
