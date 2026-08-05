# Current State

Base commit for this record: `1c1e8908dc14ce49f0f188d66870447eb0b40a9c`

This file separates **what is verified to work** from **what is known to be
missing or wrong**. Intentions belong in `ROADMAP.md`, not here.

## Verified working

- The Meta Messenger webhook works.
- Meta signature verification works.
- Sanitized Messenger events reach n8n.
- Real outbound Messenger sending works.
- Atomic duplicate protection works.
- Native Messenger button templates work.
- The greeting works, offering **Location**, **Opening Hours** and
  **Place an Order**.
- **Place an Order** creates a secure bot-session link.

## Known gaps and defects

- **Location** and **Opening Hours** postbacks are not implemented. The buttons
  render, but the postbacks have no handler.
- The greeting is **delayed**: the order session is created *before* the greeting
  is sent, so session creation sits on the critical path of the reply.

## Integration state

- n8n workflow name: **Atlas Messenger Webhook Receiver (STAGING)**
- n8n workflow ID: `5BKEgw3dcsEJoA3X`
- Production and external integrations remain protected. No agent-driven change
  touches them.

## Deliberately not stated here

Anything not listed above is unverified. The agent must not assume a behaviour
works because it looks implemented — if a task depends on it, the task says so
in `context` and the human confirms.
