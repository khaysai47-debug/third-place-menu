-- ============================================================================
-- Chat message dispatch idempotency — chat_message_dispatches (2026-08-02)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually,
-- SECTION BY SECTION. Never executed by any tool in this repo.
--
-- ⚠️ NOT APPLIED YET. As of this commit this file exists and nothing has been
-- run against any Supabase project. Until § 1 is applied, POST
-- /api/automation/send-chat-message answers a safe needs_review (the claim
-- insert fails and the endpoint fails closed) — it can never send.
--
-- WHAT THIS DELIVERS: one table whose UNIQUE event_id is the ONLY thing that
-- decides which caller owns a customer message send.
--
-- WHY IT EXISTS: n8n Cloud on this account cannot cap a workflow at
-- concurrency 1, and an n8n Data Table offers no confirmed unique constraint
-- and no atomic claim. "Look up, then insert" there can elect TWO owners for
-- one eventId — which is how a customer gets told twice that their payment was
-- rejected. PostgreSQL settles it in a single INSERT: one row wins, everyone
-- else gets 23505 and sends nothing. That guarantee is the entire point of this
-- table, and it lives in the database precisely because it cannot be trusted
-- anywhere else in the current stack.
--
-- WHAT THIS TABLE MUST NEVER HOLD: the raw external chat id (PSID/IGSID), the
-- message text, an Authorization header, a JWT, any shared secret, or a
-- provider response body. It holds identifiers, a lifecycle state, and a KEYED
-- one-way chat_ref for correlation. The CHECK constraints below make several of
-- those unrepresentable rather than merely discouraged.
--
-- ⚠️ DEPLOYMENT ORDER: run this file BEFORE the endpoint is pointed at a real
-- provider. The endpoint fails closed without it; nothing existing is broken by
-- running ahead.
--
-- ⚠️ ROLLBACK ORDER IS THE REVERSE: revert/redeploy the app FIRST, then § 6.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ RUN § 0 (READ-ONLY PRE-CHECK) FIRST AND REVIEW EVERY RESULT.          ║
-- ║     SELECT-only, safe against Production. Everything from § 1 MUTATES.    ║
-- ║                                                                          ║
-- ║  ⚠️ The § 5b FUNCTIONAL tests create real rows and are STAGING-ONLY.      ║
-- ║     Never run § 5b against Production.                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════════════
-- § 0. PRE-CHECK — READ-ONLY. Run every query, review before continuing.
-- ════════════════════════════════════════════════════════════════════════════

-- 0a. The table must NOT already exist (expect null). A non-null result means
--     someone created it by hand — stop and diff its shape against § 1 before
--     running anything below.
select to_regclass('public.chat_message_dispatches') as must_be_null;

-- 0b. No name collision on the constraint/index names § 1 introduces:
select conname from pg_constraint where conname like 'chat_message_dispatches%';
select indexname from pg_indexes
  where schemaname = 'public' and indexname like 'chat_message_dispatches%';

-- 0c. pgcrypto/gen_random_uuid is NOT required here — event_id is supplied by
--     the caller (Atlas generates it with crypto.randomUUID). Informational:
select extname from pg_extension order by extname;

-- ⛔ STOP. Only continue once 0a returns null.


-- ════════════════════════════════════════════════════════════════════════════
-- § 1. The table   ◀── first mutating statement is `begin;`
-- ════════════════════════════════════════════════════════════════════════════
begin;

create table public.chat_message_dispatches (
  -- THE IDEMPOTENCY KEY AND THE LOCK IN ONE COLUMN. PRIMARY KEY (not merely
  -- indexed): the insert IS the claim, and PostgreSQL's uniqueness check is
  -- what makes exactly one concurrent caller the owner. Every duplicate gets
  -- SQLSTATE 23505 naming chat_message_dispatches_pkey, which the app maps to
  -- "already claimed — send nothing". Remove this and the whole design is a
  -- race again.
  event_id uuid primary key,

  -- The Atlas order-number formats (TP-/TP-S-/TP-IG-/TP-MS-) with the TP-
  -- prefix REQUIRED, not merely permitted by the charset. Kept for operator
  -- legibility: it is the one field a human can act on without any lookup.
  -- BYTE-IDENTICAL to ORDER_NUMBER_PATTERN in
  -- api/_lib/chatMessaging.server.ts. If these two ever disagree, the app
  -- accepts a value the database then rejects, and the claim insert fails on a
  -- constraint the endpoint reads as "store unavailable".
  order_number text not null
    constraint chat_message_dispatches_order_number_format
    check (order_number ~ '^TP-[A-Za-z0-9-]{1,29}$'),

  -- Matches the bot members of ORDER_EVENT_CHANNELS exactly, like
  -- bot_sessions.platform. text + CHECK rather than an enum type so adding a
  -- channel later needs no type migration.
  channel text not null
    constraint chat_message_dispatches_channel_check
    check (channel in ('instagram', 'messenger')),

  -- KEYED one-way reference to the conversation — HMAC-SHA256 over
  -- (domain, channel, external_chat_id) keyed with CHAT_MESSAGING_SECRET,
  -- truncated to 16 hex characters. The RAW PSID/IGSID IS NEVER STORED HERE.
  -- The format CHECK is the guard that matters: a raw Meta chat id is a long
  -- numeric string and cannot satisfy '^[0-9a-f]{16}$', so an app regression
  -- that tried to write one would be REJECTED by the database rather than
  -- quietly persisted.
  -- ⚠️ Keyed, not salted-per-row: rotating CHAT_MESSAGING_SECRET changes every
  -- future chat_ref, so rows written across a rotation stop correlating. That
  -- is accepted — nothing joins on chat_ref; it is an operational aid only.
  chat_ref text not null
    constraint chat_message_dispatches_chat_ref_format
    check (chat_ref ~ '^[0-9a-f]{16}$'),

  -- The closed lifecycle. 'processing' is the claim; 'sent' and 'needs_review'
  -- are terminal. There is deliberately NO 'retrying' state: this system never
  -- resends automatically, because a resend after an unknown outcome is exactly
  -- the duplicate customer reply the table exists to prevent.
  state text not null default 'processing'
    constraint chat_message_dispatches_state_check
    check (state in ('processing', 'sent', 'needs_review')),

  -- Which provider handled it. Null while processing.
  provider text
    constraint chat_message_dispatches_provider_check
    check (provider is null or provider in ('meta')),

  -- The provider's own message reference (e.g. a Meta mid). An identifier only
  -- — never a response body, never a payload dump.
  message_ref text
    constraint chat_message_dispatches_message_ref_len
    check (message_ref is null or char_length(message_ref) <= 200),

  -- The closed failure vocabulary, mirrored by CHAT_ERROR_CLASSES in
  -- api/_lib/chatMessaging.server.ts. A raw provider error string never lands
  -- here: it is normalised to one of these five words first.
  error_class text
    constraint chat_message_dispatches_error_class_check
    check (error_class is null or error_class in
      ('rate_limited', 'outside_window', 'invalid_recipient', 'auth', 'other')),

  claimed_at   timestamptz not null default now(),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- State and its evidence move together, or not at all. These make "sent with
  -- nothing to point at" and "needs_review with no reason" unrepresentable.
  constraint chat_message_dispatches_sent_needs_ref
    check (state <> 'sent' or message_ref is not null),
  constraint chat_message_dispatches_review_needs_class
    check (state <> 'needs_review' or error_class is not null),
  -- A terminal row carries its completion time; a processing row does not.
  constraint chat_message_dispatches_completed_at_sync
    check ((state <> 'processing') = (completed_at is not null))
);

-- The one operational query: "what needs a human right now?" Partial on the
-- terminal review state only — an in-flight 'processing' row needs no human
-- (it is a claim that is still running), so indexing it would pad the very
-- list this index exists to keep short.
create index chat_message_dispatches_needs_review_idx
  on public.chat_message_dispatches (claimed_at desc)
  where state = 'needs_review';

comment on table public.chat_message_dispatches is
  'Idempotency ledger for outbound customer chat messages. UNIQUE event_id is the claim. Never stores the raw chat id, the message text, or any secret.';

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- § 2. Permissions — service_role ONLY
-- ════════════════════════════════════════════════════════════════════════════
-- Same posture as bot_sessions: RLS ENABLED with ZERO policies, so
-- anon/authenticated are denied even if a grant is ever added by accident.
-- service_role bypasses RLS — that is how the app's server route reaches this
-- table. No DELETE grant: an idempotency ledger that can be purged by the
-- application is not an idempotency ledger, and retention is a later,
-- deliberate decision.
begin;

alter table public.chat_message_dispatches enable row level security;

revoke all privileges on table public.chat_message_dispatches
  from public, anon, authenticated;
grant select, insert, update on table public.chat_message_dispatches to service_role;

commit;

-- Make PostgREST pick up the new table immediately.
notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- § 3. Verification (run after; read-only)
-- ════════════════════════════════════════════════════════════════════════════
-- a) Columns and defaults:
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'chat_message_dispatches'
  order by ordinal_position;

-- b) Constraints — expect the PK plus order_number_format, channel_check,
--    chat_ref_format, state_check, provider_check, message_ref_len,
--    error_class_check, sent_needs_ref, review_needs_class,
--    completed_at_sync:
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.chat_message_dispatches'::regclass
  order by conname;

-- c) THE claim guarantee — event_id must be UNIQUE. Expect exactly one row
--    describing a PRIMARY KEY / unique index on (event_id):
select indexname, indexdef from pg_indexes
  where schemaname = 'public' and tablename = 'chat_message_dispatches'
  order by indexname;

-- d) RLS on, zero policies:
select relrowsecurity from pg_class
  where oid = 'public.chat_message_dispatches'::regclass;          -- expect true
select policyname from pg_policies
  where schemaname = 'public' and tablename = 'chat_message_dispatches';  -- 0 rows

-- e) No anon/authenticated privileges of any kind — expect 0 rows from both:
select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'chat_message_dispatches'
    and grantee in ('anon', 'authenticated');
select grantee, column_name, privilege_type from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'chat_message_dispatches'
    and grantee in ('anon', 'authenticated');

-- f) service_role has SELECT/INSERT/UPDATE and NO DELETE:
select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'chat_message_dispatches'
    and grantee = 'service_role'
  order by privilege_type;


-- ════════════════════════════════════════════════════════════════════════════
-- § 5b. FUNCTIONAL TESTS — ⚠️ STAGING ONLY. Never run against Production.
-- ════════════════════════════════════════════════════════════════════════════
-- Creates real rows; ends with cleanup. Every statement is scoped by the test
-- event ids below.
--
-- T1. THE CLAIM. The second insert must FAIL with 23505 — that failure IS the
--     duplicate protection, so a passing T1 is the whole migration working:
--   insert into public.chat_message_dispatches
--     (event_id, order_number, channel, chat_ref, state, claimed_at)
--   values ('11111111-1111-4111-8111-111111111111', 'TP-IG-SQL01', 'instagram',
--           'abcdef0123456789', 'processing', now());          -- ok
--   insert into public.chat_message_dispatches
--     (event_id, order_number, channel, chat_ref, state, claimed_at)
--   values ('11111111-1111-4111-8111-111111111111', 'TP-IG-SQL01', 'instagram',
--           'abcdef0123456789', 'processing', now());
--     → ERROR 23505 chat_message_dispatches_pkey
--
-- T2. RAW CHAT ID IS UNREPRESENTABLE. A real PSID cannot be written:
--   update public.chat_message_dispatches set chat_ref = '17841400000000001'
--     where event_id = '11111111-1111-4111-8111-111111111111';
--     → ERROR chat_message_dispatches_chat_ref_format
--
-- T3. Closed vocabularies:
--   update public.chat_message_dispatches set state = 'retrying'
--     where event_id = '11111111-1111-4111-8111-111111111111';
--     → ERROR chat_message_dispatches_state_check
--   update public.chat_message_dispatches set error_class = 'weird'
--     where event_id = '11111111-1111-4111-8111-111111111111';
--     → ERROR chat_message_dispatches_error_class_check
--
-- T4. State/evidence pairing:
--   update public.chat_message_dispatches
--     set state = 'sent', completed_at = now()
--     where event_id = '11111111-1111-4111-8111-111111111111';
--     → ERROR chat_message_dispatches_sent_needs_ref
--   update public.chat_message_dispatches
--     set state = 'needs_review', completed_at = now()
--     where event_id = '11111111-1111-4111-8111-111111111111';
--     → ERROR chat_message_dispatches_review_needs_class
--   update public.chat_message_dispatches
--     set state = 'sent', message_ref = 'mock-1', provider = 'meta',
--         completed_at = now(), updated_at = now()
--     where event_id = '11111111-1111-4111-8111-111111111111';   -- ok
--
-- T5. A terminal row must carry completed_at:
--   update public.chat_message_dispatches set completed_at = null
--     where event_id = '11111111-1111-4111-8111-111111111111';
--     → ERROR chat_message_dispatches_completed_at_sync
--
-- ── § 5b CLEANUP ──
-- delete from public.chat_message_dispatches
--   where order_number like 'TP-IG-SQL%';
-- (service_role holds no DELETE grant — run the cleanup as the SQL Editor's
--  owner role, which is how every other § cleanup in this repo runs.)


-- ════════════════════════════════════════════════════════════════════════════
-- § 6. ROLLBACK (commented out — copy lines out to use)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ APP FIRST. Revert/redeploy the app commit BEFORE running any of this.
-- The endpoint fails closed once the table is gone (the claim insert fails and
-- it answers needs_review), so an ordering slip degrades safely rather than
-- sending anything.
--
-- ⚠️ DATA LOSS: dropping this table destroys the record of which messages were
-- already sent. If any real message has ever been dispatched, EXPORT FIRST:
--   select event_id, order_number, channel, chat_ref, state, provider,
--          message_ref, error_class, claimed_at, completed_at
--     from public.chat_message_dispatches order by claimed_at;
--
-- drop table if exists public.chat_message_dispatches;
--
-- notify pgrst, 'reload schema';
