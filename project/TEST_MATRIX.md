# Test Matrix

Which checks a task must declare in `requiredChecks`, by area.

The runner supports three checks, each mapped to an existing package script:

| Check | Script | What it proves |
| --- | --- | --- |
| `typecheck` | `npm run typecheck` (`tsc --noEmit`) | Types are sound across `src/`, `api/`, config |
| `lint` | `npm run lint` (`eslint .`) | Lint rules **and** Prettier formatting pass |
| `build` | `npm run build` (`vite build`) | The app actually builds |

`npm run format` is **never** run as a check: it rewrites files. Formatting is
verified through `lint`.

The agent itself is covered by `npm run agent:test`, which runs two suites:

| Suite | Command | What it covers |
| --- | --- | --- |
| `agent/agent.test.mjs` | (included in `agent:test`) | Coordinator gates, exit-code mapping, checkpoint and schema validation, using a fake git reader |
| `agent/engine.test.mjs` | `npm run agent:test:engine` | The full execution loop against **real temporary git repositories** with **fake Builder and Reviewer adapters** |

The engine suite covers: preflight refusals (unapproved, wrong base commit, dirty
repository, protected permission, existing branch) with an assertion that **no
adapter is invoked**; the happy path to `READY_FOR_HUMAN_REVIEW`; `PASS` with no
diff; scope violations; check `NEW_FAILURE` → revision → pass; the revision
budget; reviewer `REVISE`/`NEEDS_HUMAN`/malformed; repeated identical failure;
usage-limit checkpointing; scheduled and manual resume; resume refusal after the
base commit moves; adapter command construction and output classification.

No test invokes Claude or Codex, touches the network, consumes quota, commits,
pushes or deploys. Temporary repositories, branches and worktrees are removed in
`afterEach`, and every test asserts the main checkout stays clean.

## Check result model

A check does not simply pass or fail. Every check returns one of three results
(`CHECK_RESULTS` in `agent/schemas.mjs`):

| Result | Meaning | Blocking? |
| --- | --- | --- |
| `PASS` | The check succeeded. | – |
| `NEW_FAILURE` | A failure this run is accountable for. | **Yes.** Stops the run. |
| `BASELINE_FAILURE` | A failure that already existed at the base commit and was not made worse. | No. Recorded and reported. |

`typecheck` and `build` have no baseline: they are `PASS` or `NEW_FAILURE`.

## Lint baseline

**Line-ending normalization is complete (2026-08-05).** `.gitattributes` now
pins every text format to `eol=lf`, and the working tree was converted from CRLF
to LF. The repository content itself never changed — it was always stored LF; the
CRLF existed only in the Windows checkout produced by `core.autocrlf=true`.

| | Errors | CRLF errors |
| --- | --- | --- |
| Before normalization | 25,677 | 25,637 |
| **After normalization** | **317** | **0** |

The remaining 317 are genuine pre-existing debt, not line endings:

| Rule | Count |
| --- | --- |
| `prettier/prettier` (wrapping, indentation) | 315 |
| `no-control-regex` | 1 |
| `no-useless-escape` | 1 |

Concentrated in 36 files; `src/routes/owner.tsx` (111), `src/data/menu.ts` (63),
`src/components/staff/OrderDetailDrawer.tsx` (24) and
`src/components/staff/ExpenseView.tsx` (16) account for two thirds. Clearing it
is its own approved maintenance task — see `ROADMAP.md`.

That debt is real and must stay visible. It is not any individual task's fault,
and no task may quietly resolve it. So:

- **Classification is by ownership, not by rule.** ESLint errors are per-file, so
  an error in a file the run never opened cannot be the run's fault. `runLint(changedFiles)`
  marks errors in **unchanged** files as `BASELINE_FAILURE` and errors in
  **changed** files as `NEW_FAILURE` — whatever the rule, including a stray CR,
  because the agent wrote that line.
- **Changed files must pass lint, completely.** Claiming a file means owning
  every error in it.
- **Agents must not introduce new lint failures.** Any error in a changed file
  blocks the run.
- **The baseline stays visible.** Every run report carries the baseline count and
  a `crlf` / `other` breakdown. Never suppressed, never marked green.
- **Bulk formatting is a separate task.** Clearing the remaining 315
  `prettier/prettier` errors reformats 36 files and must not ride along inside a
  feature task's diff.

### What normalization changed for agent tasks

Before, every existing file carried CRLF in the working tree, so editing *any*
file inherited ~100+ CR errors as `NEW_FAILURE` and the run was blocked through
no fault of the change. That is fixed. Measured after normalization:

| Task claims | Result | New failures |
| --- | --- | --- |
| nothing | `BASELINE_FAILURE` | 0 |
| `src/lib/utils.ts` | `BASELINE_FAILURE` | 0 |
| `src/lib/menuSession.ts` | `BASELINE_FAILURE` | 0 |
| `src/data/menu.ts` | `NEW_FAILURE` | 63 |

Most of the codebase is now editable by an agent without a spurious block. The
36 files that still carry genuine formatting debt will still block a task that
edits them — correctly, since "clean what you touch" now asks for something
achievable. Check `TEST_MATRIX.md`'s file list before scoping `allowedPaths`.

The CRLF pattern is defined in one place: `LINT_BASELINE` in `agent/checks.mjs`.
See decision D-009.

## By area

| Area | typecheck | lint | build | Also required |
| --- | --- | --- | --- | --- |
| Documentation only | – | – | – | Human read. No code changed, so no check applies. |
| UI (customer menu, components) | ✅ | ✅ | ✅ | Manual visual check; accessibility contrast where colour changes |
| API / server (`api/**`) | ✅ | ✅ | ✅ | The relevant `scripts/test-*.mjs` suite for the touched endpoint |
| Messenger | ✅ | ✅ | ✅ | `npm run test:meta-messenger-webhook`; **no** real send, **no** n8n change |
| Bot session | ✅ | ✅ | ✅ | `npm run test:bot-session` |
| Dashboard | ✅ | ✅ | ✅ | `npm run test:dashboard`, `npm run test:dashboard-parity` |
| Payment | ✅ | ✅ | ✅ | `npm run test:payment-intake`, `test:payment-proof`, `test:proof-review`; critical approval, **no** real payment |
| Supabase / authentication | ✅ | ✅ | ✅ | `npm run test:supabase-auth`; schema changes need critical approval |

✅ = required. "–" = not applicable.

## Rules

- A task that touches code declares at minimum `typecheck`, `lint` and `build`.
- A task that touches `agent/**` also runs `agent:test`.
- A documentation-only task declares no checks and must have `allowedPaths`
  limited to documentation.
- The "Also required" column lists suites the runner does not execute yet in this
  bootstrap. Until it does, they are run by a human and their result is recorded
  in the task's evidence.
- Messenger, payment and Supabase suites are offline by design — they stub every
  fetch. A check that would send a real message, create a real order or write to
  Production is not a check; it is a Tier 3 action.
