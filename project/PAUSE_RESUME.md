# Pause and Resume

**Design only.** No scheduler and no Claude resume command exist in this
bootstrap. This page defines the states, the checkpoint and the rules that the
implementation must obey when it is built.

A usage limit is not a failure. The plan is sound, the code is fine, the account
is simply out of quota until a reset time. Treating that as a failed
implementation round would burn a revision budget and — worse — tempt the runner
into restarting work that was already half done.

## Run states

Beyond the terminal statuses in `agent/schemas.mjs` (`FINAL_STATUSES`), a run may
be in one of five pause/resume states (`PAUSE_STATES`):

| State | Meaning |
| --- | --- |
| `PAUSED_USAGE_LIMIT` | Model usage quota exhausted. Recoverable. Waiting for reset. |
| `PAUSED_AUTH_REQUIRED` | Credentials expired or a login is needed. Recoverable, but only a human can clear it. |
| `PAUSED_NETWORK_ERROR` | Transport failure reaching the model. Recoverable. |
| `RESUME_SCHEDULED` | A resume time has been chosen; the runner is waiting for it. |
| `RESUMING` | Revalidating and re-attaching to the stored session right now. |

## Transitions

```
  RUNNING ──usage limit──▶ PAUSED_USAGE_LIMIT ─┐
          ──auth expired─▶ PAUSED_AUTH_REQUIRED ├─▶ RESUME_SCHEDULED ─▶ RESUMING ─┐
          ──network err──▶ PAUSED_NETWORK_ERROR ─┘                                 │
                                                                                   │
        ┌──────────────────────────────────────────────────────────────────────────┘
        │  execution preflight re-runs from scratch
        ├─ all gates pass ──▶ RUNNING (continue from lastSuccessfulStage)
        └─ any gate fails ──▶ terminal status (BASE_COMMIT_MISMATCH,
                              DIRTY_REPOSITORY, WORKTREE_CONFLICT, INVALID_TASK,
                              BLOCKED_PERMISSION, READY_FOR_APPROVAL, FAILED)
```

`PAUSED_AUTH_REQUIRED` only reaches `RESUME_SCHEDULED` after a human clears the
credential problem. The runner never resolves an auth pause on its own.

## Checkpoint

Written at every stage boundary and at every pause. Validated by
`validateCheckpoint()` in `agent/schemas.mjs`.

| Field | Type | Purpose |
| --- | --- | --- |
| `runId` | string | Identifies the run and its reports |
| `taskId` | string | The task being executed |
| `stage` | stage | Where the run is now |
| `builderSessionId` | string \| null | Claude session to re-attach to; null before one exists |
| `worktreePath` | string | The isolated worktree holding the work in progress |
| `baseCommit` | string | Commit the task was approved against |
| `currentCommit` | string | HEAD observed at checkpoint time |
| `implementationRound` | integer | Implementation rounds consumed (max 2) |
| `revisionRound` | integer | Revision rounds consumed (max 2) |
| `filesChanged` | string[] | Files touched so far, for evidence and lint ownership |
| `lastSuccessfulStage` | stage \| null | Where a resume restarts from |
| `pauseReason` | `usage_limit` \| `auth_required` \| `network_error` \| null | Why it paused |
| `expectedRetryAt` | ISO string \| null | Reset time, when the provider gave one |
| `retryCount` | integer | Resume attempts so far, for backoff bounds |
| `updatedAt` | ISO string | When this checkpoint was written |

Stages: `planning`, `implementation`, `checks`, `review`, `revision`,
`reporting`, `complete`.

## Rules

**Accounting**

- Usage limits are recoverable pauses, not implementation failures.
- A usage pause consumes **no** implementation round and **no** revision round.
  `implementationRound` and `revisionRound` are untouched by a pause.
- `retryCount` tracks resumes and is the only counter a pause increments.

**Preserving work**

- Preserve the worktree and the checkpoint across a pause. Nothing is cleaned up
  on pause.
- Never restart the task blindly. A resume continues from
  `lastSuccessfulStage`; it does not re-run completed stages.
- Resume the stored Claude session (`builderSessionId`) when possible. Start a
  fresh session only when the stored one cannot be re-attached, and record that
  in the run report — a fresh session has lost the reasoning context and the
  human should know.

**Safety on resume**

- Revalidate repository and worktree integrity before resuming: the full
  execution preflight runs again from scratch (`executionPreflight()`). A
  checkpoint is a memory of where work stopped, never an authorization to
  continue.
- If HEAD has moved, the tree is dirty, the worktree is missing or foreign, or
  approval has been withdrawn, the run does not resume — it stops with the
  matching terminal status and tells the human.

**Cost and consent**

- Never automatically switch to paid API usage to escape a usage limit.
  Escalating spend is a human decision, every time.

**Notification**

- Notify the user on every state change that matters: paused, resumed,
  completed, blocked. A silent pause is indistinguishable from a hang.

**Timing**

- If an exact reset time is available, schedule the resume shortly after it
  (`expectedRetryAt` plus a small margin).
- Otherwise use bounded cautious retries with backoff and a hard cap on
  `retryCount`. When the cap is reached, stop and escalate to the human rather
  than retrying indefinitely.

## Hosting reality

- Local automatic resume requires the PC to stay awake and the runner process to
  stay alive. If the machine sleeps, the resume does not happen — the checkpoint
  survives, but a human has to restart the runner.
- Future VPS hosting would make 24/7 resume reliable. Until then, a pause
  overnight most likely means a human resumes it in the morning.
