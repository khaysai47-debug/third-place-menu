-- ============================================================================
-- Phase 3D — BLOCKING PRODUCTION PRE-CHECK (2026-07-22)
-- ============================================================================
-- READ-ONLY. Every statement in this file is a SELECT against catalog or
-- information_schema views. NOTHING here creates, alters, drops, inserts,
-- updates, deletes, or grants. It is safe to run against Production.
--
-- RUN THIS FILE FIRST, ON ITS OWN, AND REVIEW EVERY ROW,
-- BEFORE running docs/sql/2026-07-22-3D-bot-sessions.sql.
--
-- WHY IT IS SEPARATE: the migration replaces public.create_order_with_items —
-- the function EVERY order flows through — to add the instagram/messenger
-- channels. If the live schema restricts orders.source, orders.order_type, or
-- the LENGTH of orders.order_number in a way the repo does not record, the
-- migration will install cleanly and then FAIL AT RUNTIME on the first bot
-- order. Keeping the pre-check in the same file as the migration meant a
-- single paste-and-run could apply the migration before anyone read the
-- result. That is the human-error this split removes.
--
-- ⚠️ A RETURNED ROW IS NOT AUTOMATICALLY A BLOCKER.
-- Classify every row by its ACTUAL DEFINITION using the guidance under each
-- section. Blocking conditions are stated explicitly and are the ONLY
-- conditions that block. Anything you cannot classify with confidence is a
-- STOP-and-review, not a guess.
--
-- What the repo does and does not know (docs/schema-discovery-notes.md):
--   * Column NAMES for public.orders are recorded.
--   * Column TYPES, LENGTH LIMITS, enum/domain backing, and triggers are NOT
--     recorded anywhere. Sections B, C and D exist precisely because of that.


-- ════════════════════════════════════════════════════════════════════════════
-- § A. Table CHECK constraints on public.orders
-- ════════════════════════════════════════════════════════════════════════════
-- Finds CHECK constraints whose definition mentions the three columns the
-- migration touches. \m…\M are word boundaries, so this does not match
-- unrelated columns that merely contain those strings.
--
-- NOTE: this section CANNOT see enum or domain restrictions — a column can be
-- tightly constrained with ZERO rows here. § C covers that case, and you must
-- run it even if this section returns nothing.

select con.conname,
       pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
 where nsp.nspname = 'public'
   and rel.relname = 'orders'
   and con.contype = 'c'
   and pg_get_constraintdef(con.oid) ~* '\m(source|order_type|order_number)\M';

-- ── INTERPRETATION (§ A) ────────────────────────────────────────────────────
--
--  SAFE — proceed:
--    * A CHECK on order_type allowing 'dine_in', 'pickup' and 'delivery'.
--      Phase 3D adds NO new order type, so an existing correct order_type
--      constraint is unaffected.
--    * A CHECK on source that enumerates values AND already includes
--      'instagram' and 'messenger'.
--    * Harmless non-enumerating checks, e.g. (source IS NOT NULL),
--      (order_number IS NOT NULL), (char_length(order_number) > 0),
--      (total >= 0). These constrain presence or shape, not the value set.
--
--  BLOCKER — stop:
--    * A CHECK on source that enumerates allowed values and EXCLUDES
--      'instagram' or 'messenger'
--      (e.g. check (source in ('customer_menu','staff_manual'))).
--      → Widen it in its own separately reviewed migration step FIRST.
--
--  STOP AND REVIEW MANUALLY:
--    * Any constraint whose purpose is not immediately obvious.
--    * Any constraint referencing order_number's length or format.
--    Do not classify by guesswork.


-- ════════════════════════════════════════════════════════════════════════════
-- § B. Column types and LENGTH LIMITS
-- ════════════════════════════════════════════════════════════════════════════
-- The length question is NEW in Phase 3D and is not covered by § A at all.

select column_name,
       data_type,
       udt_name,
       character_maximum_length,
       is_nullable,
       column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'orders'
   and column_name in ('source', 'order_type', 'order_number')
 order by column_name;

-- ── INTERPRETATION (§ B) ────────────────────────────────────────────────────
--
--  WHY order_number LENGTH MATTERS. The order number is
--  <prefix> || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD-HH24MISS'),
--  where the timestamp part is always 15 characters, plus an optional
--  '-2'…'-6' suffix on a same-second collision:
--
--      TP-     + 15                 = 18   existing customer orders
--      TP-S-   + 15                 = 20   existing staff orders   ← old maximum
--      TP-IG-  + 15                 = 21   NEW (instagram)
--      TP-MS-  + 15                 = 21   NEW (messenger)
--      TP-IG-  + 15 + '-6'          = 23   NEW worst case          ← new maximum
--
--  Phase 3D therefore raises the longest possible order_number from 20 to 23.
--  A varchar(20) column is entirely plausible — TP-S- lands exactly on 20 —
--  and would reject EVERY bot order at runtime.
--
--  BLOCKER — stop:
--    * order_number.character_maximum_length IS NOT NULL AND < 23.
--      → Widen the column (or switch it to text) in its own separately
--        reviewed step FIRST.
--
--  SAFE — proceed:
--    * order_number.data_type = 'text' (character_maximum_length is null), or
--      character_maximum_length >= 23.
--
--  ALSO CHECK, same rules applied to the values Phase 3D writes:
--    * source must accept 'instagram' and 'messenger' (9 characters each).
--      The existing value 'customer_menu' is 13 characters, so any column wide
--      enough today is already wide enough — but confirm it rather than assume.
--    * order_type is unchanged by Phase 3D; it is listed here only to complete
--      the picture.
--
--  NOTE: if data_type is 'USER-DEFINED', the real restriction lives in the
--  backing type — go to § C. udt_name names that type.


-- ════════════════════════════════════════════════════════════════════════════
-- § C. ENUM and DOMAIN restrictions on the backing type
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ DO NOT SKIP THIS SECTION IF § A RETURNED ZERO ROWS.
-- An enum-backed or domain-backed column is fully constrained while producing
-- NO table CHECK constraint at all. § A returning nothing is therefore NOT
-- evidence that the column is unrestricted — it is only evidence that no table
-- CHECK exists. This section is the one that catches that case.

select a.attname                                   as column_name,
       t.typname                                   as backing_type,
       t.typtype                                   as type_kind,   -- e=enum, d=domain, b=base
       case t.typtype
         when 'e' then (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
                          from pg_enum e
                         where e.enumtypid = t.oid)
         when 'd' then (select string_agg(pg_get_constraintdef(c.oid), ' | ')
                          from pg_constraint c
                         where c.contypid = t.oid)
         else '(base type — no enum labels or domain constraints)'
       end                                         as allowed_values
  from pg_attribute a
  join pg_class      rel on rel.oid = a.attrelid
  join pg_namespace  nsp on nsp.oid = rel.relnamespace
  join pg_type       t   on t.oid   = a.atttypid
 where nsp.nspname = 'public'
   and rel.relname = 'orders'
   and a.attname in ('source', 'order_type', 'order_number')
   and a.attnum > 0
   and not a.attisdropped
 order by a.attname;

-- For a DOMAIN, also inspect what it is built on (length limits live there):
select t.typname as domain_name,
       pg_catalog.format_type(t.typbasetype, t.typtypmod) as base_type,
       t.typnotnull as domain_not_null
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public'
   and t.typtype = 'd'
   and t.typname in (
     select ty.typname
       from pg_attribute a
       join pg_class rel on rel.oid = a.attrelid
       join pg_namespace nsp on nsp.oid = rel.relnamespace
       join pg_type ty on ty.oid = a.atttypid
      where nsp.nspname = 'public' and rel.relname = 'orders'
        and a.attname in ('source', 'order_type', 'order_number')
   );

-- ── INTERPRETATION (§ C) ────────────────────────────────────────────────────
--
--  SAFE — proceed:
--    * type_kind = 'b' for all three columns (plain text/varchar). The value
--      set is unrestricted by type; § A and § B govern.
--    * An ENUM on source whose labels already include 'instagram' and
--      'messenger'.
--    * A DOMAIN on source whose constraints permit those two values.
--    * Any enum/domain on order_type that allows dine_in, pickup and delivery
--      (Phase 3D adds no order type).
--
--  BLOCKER — stop:
--    * An ENUM on source whose labels do NOT include 'instagram' and
--      'messenger'.
--      → Fix FIRST, in its own separately reviewed step:
--            alter type <backing_type> add value if not exists 'instagram';
--            alter type <backing_type> add value if not exists 'messenger';
--        (ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
--         older servers — run it standalone and re-run § C to confirm.)
--    * A DOMAIN on source whose constraint excludes those values.
--    * A DOMAIN on order_number whose base type is shorter than 23 characters.
--
--  STOP AND REVIEW MANUALLY:
--    * Any backing type you do not recognise.


-- ════════════════════════════════════════════════════════════════════════════
-- § D. Triggers on public.orders
-- ════════════════════════════════════════════════════════════════════════════
-- A trigger can validate, reject, rewrite, or derive a column regardless of
-- constraints and types. None is recorded in the repo; confirm live.

select tgname                        as trigger_name,
       pg_get_triggerdef(oid)        as definition,
       tgenabled                     as enabled_state   -- O=origin, D=disabled, R=replica, A=always
  from pg_trigger
 where tgrelid = 'public.orders'::regclass
   and not tgisinternal
 order by tgname;

-- ── INTERPRETATION (§ D) ────────────────────────────────────────────────────
--
--  SAFE — proceed:
--    * Zero rows.
--    * A trigger that only maintains updated_at, or writes an audit row, and
--      does not read or modify source / order_type / order_number.
--
--  STOP AND REVIEW MANUALLY — this is not automatically a blocker, but it MUST
--  be read before approval:
--    * ANY trigger that validates, rejects, rewrites, or derives
--      source, order_type, or order_number.
--    * ANY trigger whose function body you have not read.
--    Read the function body before deciding:
--        select prosrc from pg_proc where oid = '<trigger function>'::regproc;


-- ════════════════════════════════════════════════════════════════════════════
-- § E. Existing RPC baseline (Phase 2G-I)
-- ════════════════════════════════════════════════════════════════════════════
-- The migration REPLACES this function. Confirm the live definition is the
-- 2G-I baseline the Phase 3D change was written against, and not something
-- that drifted out-of-band. Read-only: this section NEVER creates an order.

-- E1. The function exists exactly once, is SECURITY INVOKER, and pins its
--     search_path. Expect: one row, is_security_definer = false,
--     proconfig = {search_path=public, pg_temp}.
select p.proname,
       p.prosecdef                                  as is_security_definer,
       p.proconfig,
       pg_get_function_identity_arguments(p.oid)    as signature,
       p.pronargs                                   as parameter_count
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname = 'create_order_with_items';

-- E2. Signature must be the expected NINE parameters, in order:
--     text, text, text, text, text, text, text, text, jsonb
--     (p_channel, p_client_request_id, p_order_type, p_table_number,
--      p_customer_name, p_customer_phone, p_customer_address,
--      p_customer_note, p_items)
--     Expect exactly one row with matches = true.
select pg_get_function_identity_arguments(p.oid) as signature,
       pg_get_function_identity_arguments(p.oid)
         = 'text, text, text, text, text, text, text, text, jsonb' as matches
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname = 'create_order_with_items';

-- E3. EXECUTE is service_role-only. Expect NO anon / authenticated / PUBLIC row.
select grantee, privilege_type
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and routine_name = 'create_order_with_items'
 order by grantee;

-- E4. The live body still resolves customer/staff exactly as 2G-I wrote it,
--     and does NOT already mention the bot channels. Expect:
--       has_customer_menu = true, has_staff_manual = true,
--       already_has_instagram = false, already_has_messenger = false.
--     If the instagram/messenger flags are TRUE, some form of this migration
--     was already applied — STOP and reconcile before re-running it.
select position('customer_menu' in p.prosrc) > 0 as has_customer_menu,
       position('staff_manual'  in p.prosrc) > 0 as has_staff_manual,
       position('instagram'     in p.prosrc) > 0 as already_has_instagram,
       position('messenger'     in p.prosrc) > 0 as already_has_messenger,
       position('order_id'      in p.prosrc) > 0 as already_returns_order_id
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname = 'create_order_with_items';

-- E5. Observed source values already in the data. Expect only 'customer_menu'
--     and 'staff_manual' (plus possibly legacy values). This is a sanity read
--     of what the column actually holds — it does not authorise anything.
select source, count(*) as orders
  from public.orders
 group by source
 order by orders desc;

-- E6. Longest order_number currently stored — a live floor for the § B length
--     question. Expect <= 20 today.
select max(char_length(order_number)) as longest_order_number_today
  from public.orders;

-- E7. The 2G-I idempotency objects the migration depends on. Expect one column
--     row and one index row.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'orders'
   and column_name = 'client_request_id';
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'orders'
   and indexname = 'orders_client_request_id_key';

-- E8. bot_sessions must NOT already exist. Expect NULL.
--     A non-null result means the migration (or part of it) already ran —
--     STOP and reconcile rather than re-running it.
select to_regclass('public.bot_sessions') as bot_sessions_should_be_null;


-- ════════════════════════════════════════════════════════════════════════════
-- § F. DECISION CHECKLIST — complete this before approving the migration
-- ════════════════════════════════════════════════════════════════════════════
--
--  ┌──────────────────────────────────────────────────────────────────────┐
--  │  PROCEED to docs/sql/2026-07-22-3D-bot-sessions.sql ONLY WHEN ALL    │
--  │  of the following are true:                                          │
--  │                                                                      │
--  │  [ ] § A — No source CHECK constraint excludes 'instagram' or        │
--  │            'messenger'. Every returned row has been classified.      │
--  │                                                                      │
--  │  [ ] § C — No source ENUM or DOMAIN excludes 'instagram' or          │
--  │            'messenger'. (Checked EVEN IF § A returned zero rows.)    │
--  │                                                                      │
--  │  [ ] § B — orders.order_number supports at least 23 characters, or   │
--  │            is unrestricted text (character_maximum_length is null).  │
--  │                                                                      │
--  │  [ ] § D — No trigger blocks, rejects, or rewrites source,           │
--  │            order_type, or order_number. Every trigger body read.     │
--  │                                                                      │
--  │  [ ] § E — create_order_with_items matches the expected Phase 2G-I   │
--  │            baseline: exists once, SECURITY INVOKER, search_path      │
--  │            pinned, nine-parameter signature, service_role-only       │
--  │            EXECUTE, and does NOT already contain the bot channels.   │
--  │                                                                      │
--  │  [ ] § E8 — public.bot_sessions does not already exist.              │
--  │                                                                      │
--  │  [ ] EVERY unexpected row has been explained in writing and          │
--  │       recorded in the runbook notes.                                 │
--  │                                                                      │
--  │  OTHERWISE: STOP. Do not run the migration. Resolve the blocking     │
--  │  condition in its own separately reviewed step, then re-run THIS     │
--  │  FILE from the top and re-complete the checklist.                    │
--  └──────────────────────────────────────────────────────────────────────┘
--
-- Record the outputs of §§ A–E in the runbook notes before proceeding — they
-- are the only evidence that the migration was safe to apply, and § E5/§ E6
-- are the "before" snapshot for post-migration comparison.
--
-- REMINDER: nothing in this file mutates schema or data. The migration is a
-- separate file and is not reachable from here.
