# Roadmap

**Intentions, not facts.** Nothing on this page is implemented unless
`CURRENT_STATE.md` says so.

## Agent

1. **Bootstrap (this commit's working tree).** Memory, task schema, permission
   gates, execution-time revalidation, baseline-aware checks, workspace
   planning, reports, dry run, coordinator tests, pause/resume schema. No model
   execution, no scheduler.
2. **Builder execution.** Run Claude inside a real isolated worktree on an
   approved task, with the diff confined to `allowedPaths`.
3. **Reviewer execution.** Run Codex against the diff and evidence, returning
   `PASS` / `REVISE` / `NEEDS_HUMAN`.
4. **Evidence-backed handoff.** A completed run leaves a human a diff, check
   results and a verdict — still uncommitted.
5. **Pause scheduler and session resume.** Implement the states, checkpoint and
   rules already defined in `PAUSE_RESUME.md`. Local resume needs the PC awake;
   reliable 24/7 resume needs VPS hosting.

## Maintenance

- ~~**Repository-wide line-ending normalization.**~~ **Done 2026-08-05.**
  `.gitattributes` pins text to `eol=lf`; 172 working-tree files converted;
  lint went 25,677 → 317 errors with 0 line-ending errors. No tracked content
  changed. See D-012.
- **Bulk Prettier formatting.** 315 `prettier/prettier` errors remain across 36
  files (`src/routes/owner.tsx` 111, `src/data/menu.ts` 63,
  `src/components/staff/OrderDetailDrawer.tsx` 24, `ExpenseView.tsx` 16, rest
  smaller). Auto-fixable, but it reformats 36 files and must be its own approved
  task. Until then, a task editing one of those files will be blocked by that
  file's own debt.
- **Two non-formatting lint errors.** One `no-control-regex`
  (`api/_lib/orderIntake.server.ts`) and one `no-useless-escape`. Both need a
  human decision — a control-character regex is often deliberate in input
  sanitizing, so this is not a mechanical fix.

## Atlas — candidate work

Ordered by the gaps recorded in `CURRENT_STATE.md`.

1. **Implement Location and Opening Hours postbacks.** The buttons exist; the
   handlers do not.
2. **Fix the delayed greeting.** Stop creating the order session before the
   greeting is sent, so the reply is not waiting on session creation.
3. **Customer menu dark mode.** Drafted as `project/tasks/ATLAS-001.json`, not
   approved, not implemented.

## Explicitly not planned

- Agent-driven changes to n8n, Supabase, Meta Messenger, Vercel configuration,
  secrets or environment values.
- Agent-driven deployment.
- Agent-driven customer messaging, orders or payments.
