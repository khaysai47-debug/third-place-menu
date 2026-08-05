# Project: Atlas / The Third Place

Atlas is the restaurant operations system for The Third Place. It covers the
customer-facing menu and ordering flow, the staff dashboards used to run
service, and the automation that connects the two to Meta Messenger.

## Stack

- React, TypeScript
- TanStack (Router / Start / Query)
- Vite

## Platforms

- **GitHub** — source of truth for code.
- **Vercel** — hosting and serverless API. Production URL:
  <https://third-place-menu.vercel.app>
- **Supabase** — database and authentication.
- **n8n** — automation and message orchestration.
- **Meta Messenger** — the customer messaging channel.

## Scope of the Development Agent

The agent works on **application code in this repository only**.

Out of scope, always: n8n workflows, Supabase data and schema, Meta Messenger
configuration, Vercel configuration, secrets and environment values, and
anything running in Production. Those are changed by a human, deliberately.

See `CURRENT_STATE.md` for what is verified to work today, `ROADMAP.md` for what
is intended, and `PERMISSIONS.md` for what the agent may and may not do.
