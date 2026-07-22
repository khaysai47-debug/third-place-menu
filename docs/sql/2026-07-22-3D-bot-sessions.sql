-- ============================================================================
-- Phase 3D — secure bot sessions & secure customer menu links (2026-07-22)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually.
-- Never executed by any tool in this repo.
--
-- WHY: trusted server-side automation (simulated Instagram/Messenger chat)
-- must be able to hand a customer a one-time secure menu link that (a) opens
-- the normal approved menu, (b) can be reopened before checkout, (c) is
-- consumed by exactly ONE order, and (d) cannot be forged by a browser. The
-- channels instagram/messenger already exist in the app's signed vocabulary
-- (api/_lib/orderEventJwt.server.ts ORDER_EVENT_CHANNELS /
-- AUTOMATION_DISPATCH_CHANNELS) but NO route can produce them — this
-- migration creates the only trusted path that can.
--
-- ⚠️ DEPLOYMENT ORDER: run this file BEFORE deploying the Phase 3D app code
-- (same rule as 2G-H and 2G-I). § 3 REPLACES a LIVE function that every order
-- flows through, but only ADDITIVELY: existing customer/staff callers are
-- behaviourally identical, so running this ahead of the deploy is safe and the
-- new routes fail with a safe 500 until their RPCs exist.
--
-- ⚠️ ROLLBACK ORDER IS THE REVERSE: revert/redeploy the app FIRST, then run
-- § 10. Dropping these objects under a live Phase 3D deploy turns every secure
-- link into a 500. See § 10 for data-loss warnings.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ DO NOT RUN THIS MIGRATION UNTIL                                       ║
-- ║     docs/sql/2026-07-22-3D-bot-sessions-precheck.sql                     ║
-- ║     HAS BEEN RUN AND REVIEWED.                                           ║
-- ║                                                                          ║
-- ║  That file is READ-ONLY and safe to run against Production. It is a      ║
-- ║  SEPARATE file on purpose: while it lived here, one paste-and-run could  ║
-- ║  execute the pre-check AND apply the migration before anyone read the    ║
-- ║  result — which defeats the entire point of a blocking gate.             ║
-- ║                                                                          ║
-- ║  The pre-check answers four questions this file's correctness depends    ║
-- ║  on, none of which the repo records:                                     ║
-- ║    § A  Does a CHECK constraint on orders.source exclude                 ║
-- ║         'instagram' / 'messenger'?                                       ║
-- ║    § B  Does orders.order_number have a length limit below 23?           ║
-- ║         (§ 3 raises the longest possible order number from 20 to 23:     ║
-- ║          TP-IG-/TP-MS- + 15-char timestamp + a '-6' collision suffix.)   ║
-- ║    § C  Is orders.source backed by an ENUM or DOMAIN that excludes the   ║
-- ║         new values? A restricted column can produce ZERO rows in § A.    ║
-- ║    § D  Does a trigger on public.orders validate or rewrite these        ║
-- ║         columns?                                                        ║
-- ║                                                                          ║
-- ║  Complete the § F decision checklist in that file first. A returned row  ║
-- ║  there is NOT automatically a blocker — classify each one by its actual  ║
-- ║  definition using the guidance printed beside each section.              ║
-- ║                                                                          ║
-- ║  Everything below this banner MUTATES the database.                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════════════
-- § 1. The session table   ◀── FIRST EXECUTABLE STATEMENT IS THE `begin;` BELOW
-- ════════════════════════════════════════════════════════════════════════════
-- New table only. Nothing existing is altered, dropped, or rewritten.

begin;

create table public.bot_sessions (
  id uuid primary key default gen_random_uuid(),

  -- Matches the bot members of ORDER_EVENT_CHANNELS exactly. text + CHECK
  -- rather than an enum type, for the same reason as 2G-H
  -- availability_status: adding a platform later needs no type migration.
  platform text not null
    constraint bot_sessions_platform_check
    check (platform in ('instagram', 'messenger')),

  -- Meta PSID / IGSID. Closed charset, not merely a length bound: this value
  -- is a field in the token-derivation MAC input (see the app's
  -- api/_lib/botSession.server.ts canonicalTokenInput). Restricting it here
  -- removes every Unicode-normalisation and separator-injection question at
  -- the source.
  external_chat_id text not null
    constraint bot_sessions_external_chat_id_format
    check (external_chat_id ~ '^[A-Za-z0-9._-]{1,128}$'),

  -- SECURITY: the plaintext token is NEVER stored. This is sha256(token) as
  -- lowercase hex. A database leak therefore yields no usable links on its
  -- own. (See § 11 for the one caveat this does NOT cover.)
  -- text-hex rather than bytea: the value crosses two PostgREST JSON/filter
  -- boundaries where \x escaping is error-prone; hex is native to both.
  token_hash text not null
    constraint bot_sessions_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),

  -- Creation idempotency key. NOT NULL: every session is created through the
  -- one trusted route, which requires a UUIDv4. UUIDv4 (not a length bound)
  -- guarantees >= 122 bits of entropy, which is what stops an attacker who
  -- holds BOT_SESSION_TOKEN_SECRET but not the database from enumerating
  -- tokens by guessing derivation inputs. The SAME rule is enforced in the
  -- API zod schema, in create_bot_session, and in the tests.
  request_id text not null
    constraint bot_sessions_request_id_uuidv4
    check (request_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),

  status text not null default 'active'
    constraint bot_sessions_status_check
    check (status in ('active', 'completed', 'revoked')),

  -- on delete restrict: a completed session must never silently lose the
  -- order it points at.
  order_id uuid references public.orders (id) on delete restrict,

  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  revoked_at   timestamptz,

  -- State and its evidence move together, or not at all. These make
  -- "completed without an order", "order without completion", and a
  -- timestamp that disagrees with the status all unrepresentable.
  constraint bot_sessions_completed_needs_order
    check ((status = 'completed') = (order_id is not null)),
  constraint bot_sessions_completed_at_sync
    check ((status = 'completed') = (completed_at is not null)),
  constraint bot_sessions_revoked_at_sync
    check ((status = 'revoked') = (revoked_at is not null))
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- THE lookup path: every customer request resolves by hash through this
-- unique index. A direct index probe means the server never scans and never
-- compares a secret in application code.
create unique index bot_sessions_token_hash_key
  on public.bot_sessions (token_hash);

-- Creation idempotency. request_id is NOT NULL, so this is a plain unique
-- index (no partial predicate needed).
create unique index bot_sessions_request_id_key
  on public.bot_sessions (request_id);

-- EXACTLY ONE live link per chat thread. Enforced here rather than only in
-- app code so a racing pair of "menu" messages cannot both win. This is the
-- final integrity backstop behind the advisory lock in § 4.
create unique index bot_sessions_one_active_per_chat
  on public.bot_sessions (platform, external_chat_id)
  where status = 'active';

-- One order can never be claimed by two sessions.
create unique index bot_sessions_order_id_key
  on public.bot_sessions (order_id)
  where order_id is not null;

-- DELIBERATELY NO index on expires_at: expiry is evaluated on a row already
-- fetched by token_hash. An expiry index only helps a retention/sweeper job,
-- which does not exist yet. Add it together with that job.

-- ════════════════════════════════════════════════════════════════════════════
-- § 2. Access control — service_role ONLY
-- ════════════════════════════════════════════════════════════════════════════
-- Same posture the pre-pilot hardening established for orders: RLS ENABLED
-- with ZERO policies, so anon/authenticated are denied even if a grant is ever
-- added by accident. service_role bypasses RLS — that is how the app's server
-- routes reach this table. No DELETE grant: retention is a later, deliberate
-- decision, and its absence prevents an accidental purge.

alter table public.bot_sessions enable row level security;

revoke all privileges on table public.bot_sessions from public, anon, authenticated;
grant select, insert, update on table public.bot_sessions to service_role;

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- § 3. Extend create_order_with_items (ADDITIVE — replaces a LIVE function)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ This REPLACES the function every order flows through. TWO additions only:
--   (a) the instagram/messenger channel branches (previously ORDER_BAD_CHANNEL);
--   (b) 'order_id' in the returned jsonb, at all three return sites.
-- Existing customer/staff behaviour — prices, totals, order numbers, dine_in
-- nulling, idempotency, error codes — is UNCHANGED. Current TypeScript callers
-- read named keys and ignore extras, so (b) is invisible to them.
--
-- Menu pricing and order_items insertion are NOT duplicated anywhere else:
-- create_order_from_bot_session (§ 5) calls THIS function. Money logic living
-- in two places that can drift is the worst possible outcome here.
--
-- The body below is the 2G-I function VERBATIM except where marked "3D:".
--
-- ⚠️ PRE-CHECK DEPENDENCY: this section is the reason
-- docs/sql/2026-07-22-3D-bot-sessions-precheck.sql exists and must have been
-- run and reviewed first. It answers whether the live schema will actually
-- ACCEPT what this function now writes:
--   * § A/§ C — is 'instagram'/'messenger' permitted for orders.source
--               (CHECK constraint, ENUM, or DOMAIN)?
--   * § B     — does orders.order_number accept 23 characters? The TP-IG-/
--               TP-MS- prefixes raise the longest possible number from 20 to
--               23 (prefix + 15-char timestamp + a '-6' collision suffix).
--   * § D     — does a trigger reject or rewrite either column?
--   * § E     — is the live function still the 2G-I baseline this replaces?
-- If any of those blocks, fix it in its own separately reviewed step BEFORE
-- running this file.

create or replace function public.create_order_with_items(
  p_channel text,            -- 'customer' | 'staff' | 'instagram' | 'messenger'
  p_client_request_id text,
  p_order_type text,         -- 'dine_in' | 'pickup' | 'delivery'
  p_table_number text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_note text,
  p_items jsonb              -- [{"item_code": "A01", "quantity": 2}, ...]
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_source text;
  v_existing public.orders%rowtype;
  v_line record;
  v_menu public.menu_items%rowtype;
  v_status text;
  v_subtotal numeric := 0;
  v_delivery_fee numeric;
  v_resolved jsonb := '[]'::jsonb;
  v_base text;
  v_order_number text;
  v_order_id uuid;
  v_attempt int;
  v_constraint text;
begin
  -- Channel decides prefix + source — the browser can never choose either.
  -- 3D: instagram/messenger are reachable ONLY through
  -- create_order_from_bot_session, which reads the channel from the LOCKED
  -- session row. No route passes a client-supplied channel here.
  if p_channel = 'customer' then
    v_prefix := 'TP-';    v_source := 'customer_menu';
  elsif p_channel = 'staff' then
    v_prefix := 'TP-S-';  v_source := 'staff_manual';
  elsif p_channel = 'instagram' then                       -- 3D
    v_prefix := 'TP-IG-'; v_source := 'instagram';         -- 3D
  elsif p_channel = 'messenger' then                       -- 3D
    v_prefix := 'TP-MS-'; v_source := 'messenger';         -- 3D
  else
    raise exception 'ORDER_BAD_CHANNEL';
  end if;

  if p_order_type not in ('dine_in', 'pickup', 'delivery') then
    raise exception 'ORDER_BAD_TYPE';
  end if;

  if p_client_request_id is null or length(p_client_request_id) < 8
     or length(p_client_request_id) > 64 then
    raise exception 'ORDER_BAD_REQUEST_ID';
  end if;

  -- Idempotency fast path: same request id → return the original order.
  select * into v_existing
    from public.orders where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object(
      'order_id', v_existing.id,                           -- 3D
      'order_number', v_existing.order_number,
      'subtotal', v_existing.subtotal,
      'delivery_fee', v_existing.delivery_fee,
      'total', v_existing.total,
      'duplicate', true);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'ORDER_EMPTY';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'ORDER_TOO_MANY_LINES';
  end if;

  -- Resolve every line against menu_items — the ONLY source of prices/names.
  for v_line in
    select e->>'item_code' as item_code, (e->>'quantity')::int as quantity
      from jsonb_array_elements(p_items) e
  loop
    if v_line.item_code is null or v_line.quantity is null
       or v_line.quantity < 1 or v_line.quantity > 99 then
      raise exception 'ORDER_BAD_QUANTITY' using detail = coalesce(v_line.item_code, '?');
    end if;

    select * into v_menu from public.menu_items
      where item_code = v_line.item_code;
    if not found then
      raise exception 'ORDER_ITEM_UNKNOWN' using detail = v_line.item_code;
    end if;

    -- 3-state availability (2G-H); boolean fallback if status is ever null.
    v_status := coalesce(v_menu.availability_status,
                         case when v_menu.is_available then 'available' else 'sold_out' end);
    if v_status <> 'available' then
      raise exception 'ORDER_ITEM_UNAVAILABLE' using detail = v_line.item_code;
    end if;
    if v_menu.price is null or v_menu.price <= 0 then
      raise exception 'ORDER_ITEM_UNPRICED' using detail = v_line.item_code;
    end if;

    v_subtotal := v_subtotal + v_menu.price * v_line.quantity;
    v_resolved := v_resolved || jsonb_build_object(
      'menu_item_id', v_menu.id,
      'item_code', v_menu.item_code,
      'item_name', v_menu.name_en,
      'quantity', v_line.quantity,
      'unit_price', v_menu.price,
      'line_total', v_menu.price * v_line.quantity);
  end loop;

  v_delivery_fee := case when p_order_type = 'delivery' then 30 else 0 end;

  -- Server-generated order number, familiar Bangkok-time format
  -- (TP-YYYYMMDD-HHMMSS / TP-S-… / 3D: TP-IG-… / TP-MS-…). Same-second
  -- collisions retry with a -2…-6 suffix against orders_order_number.
  v_base := v_prefix || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD-HH24MISS');
  for v_attempt in 1..6 loop
    v_order_number := v_base || case when v_attempt = 1 then '' else '-' || v_attempt end;
    begin
      insert into public.orders
        (order_number, order_type, status, table_number,
         customer_name, customer_phone, customer_address, customer_note,
         source, subtotal, delivery_fee, total,
         payment_method, payment_status, client_request_id)
      values
        (v_order_number, p_order_type, 'new',
         case when p_order_type = 'dine_in' then p_table_number else null end,
         -- dine_in never stores leftover customer/delivery data:
         case when p_order_type = 'dine_in' then null else p_customer_name end,
         case when p_order_type = 'dine_in' then null else p_customer_phone end,
         case when p_order_type = 'delivery' then p_customer_address else null end,
         p_customer_note,
         v_source, v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee,
         null, 'unpaid', p_client_request_id)
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'orders_client_request_id_key' then
        -- Concurrent duplicate submit won the race — return its order.
        select * into v_existing
          from public.orders where client_request_id = p_client_request_id;
        return jsonb_build_object(
          'order_id', v_existing.id,                       -- 3D
          'order_number', v_existing.order_number,
          'subtotal', v_existing.subtotal,
          'delivery_fee', v_existing.delivery_fee,
          'total', v_existing.total,
          'duplicate', true);
      end if;
      if v_attempt = 6 then
        raise exception 'ORDER_NUMBER_EXHAUSTED';
      end if;
    end;
  end loop;

  insert into public.order_items
    (order_id, menu_item_id, item_code, item_name, quantity, unit_price, line_total, note)
  select v_order_id, (e->>'menu_item_id')::uuid, e->>'item_code', e->>'item_name',
         (e->>'quantity')::int, (e->>'unit_price')::numeric, (e->>'line_total')::numeric, null
    from jsonb_array_elements(v_resolved) e;

  -- Any failure anywhere above aborts the WHOLE function transaction —
  -- an order can never exist without its items.

  return jsonb_build_object(
    'order_id', v_order_id,                                -- 3D
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery_fee,
    'total', v_subtotal + v_delivery_fee,
    'duplicate', false);
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- § 4. Trusted session creation (advisory-locked)
-- ════════════════════════════════════════════════════════════════════════════
-- Callable by service_role only (§ 6), i.e. only by the app's trusted
-- automation route. The plaintext token exists ONLY in the calling server
-- process and in the link it sends — never in this database.

create or replace function public.create_bot_session(
  p_platform text,
  p_external_chat_id text,
  p_token_hash text,          -- sha256(deterministically derived token), hex
  p_request_id text,          -- UUIDv4
  p_ttl_hours int default 24
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing public.bot_sessions%rowtype;
  v_constraint text;
  v_id uuid;
  v_expires timestamptz;
begin
  -- Cheap argument validation FIRST: a malformed call must not take a lock.
  if p_platform is null or p_platform not in ('instagram', 'messenger') then
    raise exception 'SESSION_BAD_PLATFORM';
  end if;
  if p_external_chat_id is null
     or p_external_chat_id !~ '^[A-Za-z0-9._-]{1,128}$' then
    raise exception 'SESSION_BAD_CHAT_ID';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'SESSION_BAD_TOKEN';
  end if;
  -- SAME UUIDv4 rule as the table CHECK and the API zod schema.
  if p_request_id is null
     or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'SESSION_BAD_REQUEST_ID';
  end if;
  -- Bounded TTL: a caller bug can never mint an effectively permanent link.
  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 72 then
    raise exception 'SESSION_BAD_TTL';
  end if;

  -- ── SERIALIZATION POINT ──────────────────────────────────────────────────
  -- Concurrent creation for the SAME chat is serialized here. Without it, two
  -- callers both miss the request_id lookup (or both revoke nothing) and the
  -- second INSERT dies on a unique index with an unmapped 500.
  --
  -- TRANSACTION-scoped, never session-scoped: PostgREST runs on POOLED
  -- connections (Supavisor/PgBouncer). pg_advisory_lock would have to be
  -- released explicitly; if this function raised first, the lock would leak
  -- onto the pooled CONNECTION and block every later request for this chat
  -- for the life of that connection. pg_advisory_xact_lock is released on
  -- COMMIT *or* ROLLBACK, unconditionally.
  --
  -- Position: AFTER cheap arg validation, BEFORE the request_id lookup — two
  -- concurrent retries of the SAME key must not both miss and race to insert.
  --
  -- Key: 64-bit hash of a namespaced, LENGTH-PREFIXED (platform, chat) pair.
  -- Length-prefixing keeps the input injective — plain concatenation would
  -- let ('instagram','12') and ('instagram1','2') share a lock. A hash
  -- collision merely makes two unrelated chats queue for a few milliseconds:
  -- never a correctness fault, because the logic below keys on the real
  -- column values and bot_sessions_one_active_per_chat still enforces the
  -- invariant. No other object in this schema uses advisory locks.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'atlas.bot_session.v1' || chr(31) ||
      char_length(p_platform)::text         || ':' || p_platform         || chr(31) ||
      char_length(p_external_chat_id)::text || ':' || p_external_chat_id,
      0)
  );

  -- ── Idempotent replay (race-free under the lock) ─────────────────────────
  select * into v_existing
    from public.bot_sessions where request_id = p_request_id;
  if found then
    -- A reused key MUST belong to the same conversation. Never silently
    -- treat a mismatched idempotency key as a valid duplicate.
    if v_existing.platform is distinct from p_platform
       or v_existing.external_chat_id is distinct from p_external_chat_id then
      raise exception 'SESSION_REQUEST_ID_CONFLICT';
    end if;
    -- The caller re-derived the token deterministically (HMAC over
    -- version+platform+chat+request_id) and hashed it into p_token_hash. If
    -- it does not match what was stored, BOT_SESSION_TOKEN_SECRET was rotated
    -- (or the canonical encoding changed) since this session was created.
    -- FAIL CLOSED — never let the caller hand the customer a dead link.
    if v_existing.token_hash <> p_token_hash then
      raise exception 'SESSION_TOKEN_UNRECOVERABLE';
    end if;
    return jsonb_build_object(
      'session_id', v_existing.id,
      'status',     v_existing.status,
      'expires_at', v_existing.expires_at,
      'duplicate',  true);
  end if;

  -- A new "menu"/"order" message supersedes the previous LIVE link. Under
  -- concurrent creation with DIFFERENT request ids the later caller wins: it
  -- revokes the link the earlier caller just created (possibly milliseconds
  -- old). That is intended — one live link per chat, and the customer's
  -- 'revoked' panel covers the older link. COMPLETED sessions are never
  -- touched: their order association and completed-link page must survive.
  update public.bot_sessions
    set status = 'revoked', revoked_at = now(), updated_at = now()
    where platform = p_platform
      and external_chat_id = p_external_chat_id
      and status = 'active';

  v_expires := now() + make_interval(hours => p_ttl_hours);

  begin
    insert into public.bot_sessions
      (platform, external_chat_id, token_hash, request_id, expires_at)
    values
      (p_platform, p_external_chat_id, p_token_hash, p_request_id, v_expires)
    returning id into v_id;
  exception when unique_violation then
    -- BACKSTOP: unreachable while the advisory lock holds, kept so a future
    -- direct-SQL caller that skips the lock still cannot create a second live
    -- link or a second row for one request_id. Mirrors the lost-race handling
    -- already in create_order_with_items (2G-I § 2).
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'bot_sessions_request_id_key' then
      select * into v_existing
        from public.bot_sessions where request_id = p_request_id;
      if v_existing.platform is distinct from p_platform
         or v_existing.external_chat_id is distinct from p_external_chat_id then
        raise exception 'SESSION_REQUEST_ID_CONFLICT';
      end if;
      if v_existing.token_hash <> p_token_hash then
        raise exception 'SESSION_TOKEN_UNRECOVERABLE';
      end if;
      return jsonb_build_object(
        'session_id', v_existing.id,
        'status',     v_existing.status,
        'expires_at', v_existing.expires_at,
        'duplicate',  true);
    end if;
    raise exception 'SESSION_CREATE_CONFLICT';
  end;

  return jsonb_build_object(
    'session_id', v_id,
    'status',     'active',
    'expires_at', v_expires,
    'duplicate',  false);
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- § 5. Atomic consume-and-create
-- ════════════════════════════════════════════════════════════════════════════
-- THE reason a database function exists for this phase rather than three
-- application calls. Everything below runs in ONE transaction:
--
--   * SELECT ... FOR UPDATE serialises concurrent checkouts on the SAME
--     session; the second caller blocks, then re-reads status='completed' and
--     takes the replay-or-reject branch. No in-progress state, no reaper, no
--     stuck rows.
--   * The order insert and the session consumption cannot tear apart: any
--     failure aborts BOTH. Application-level sequencing cannot offer this —
--     PostgREST has no cross-request transaction, so a failed session update
--     after a successful insert would strand an order AND leave the session
--     able to create another one.
--   * orders.client_request_id alone does NOT prevent the duplicate: two
--     browser tabs generate two DIFFERENT requestIds, so both inserts would
--     otherwise succeed. The session row lock is what makes "one link, one
--     order" hold.
--
-- The channel is read from the LOCKED SESSION ROW. No caller can pass one.

create or replace function public.create_order_from_bot_session(
  p_token_hash text,
  p_client_request_id text,
  p_order_type text,
  p_table_number text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_note text,
  p_items jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.bot_sessions%rowtype;
  v_existing public.orders%rowtype;
  v_result jsonb;
  v_order_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'SESSION_INVALID';
  end if;

  select * into v_session
    from public.bot_sessions
    where token_hash = p_token_hash
    for update;
  if not found then
    raise exception 'SESSION_INVALID';
  end if;

  if v_session.status = 'completed' then
    select * into v_existing from public.orders where id = v_session.order_id;
    -- Same idempotency key = the customer's retry of THE SAME submit (or the
    -- loser of a concurrent race that just unblocked). Return the original
    -- order. A DIFFERENT key is a genuine second checkout — rejected.
    if v_existing.client_request_id is not distinct from p_client_request_id then
      return jsonb_build_object(
        'order_id',     v_existing.id,
        'order_number', v_existing.order_number,
        'subtotal',     v_existing.subtotal,
        'delivery_fee', v_existing.delivery_fee,
        'total',        v_existing.total,
        'platform',     v_session.platform,
        'duplicate',    true);
    end if;
    raise exception 'SESSION_COMPLETED'
      using detail = coalesce(v_existing.order_number, '');
  end if;

  if v_session.status = 'revoked' then
    raise exception 'SESSION_REVOKED';
  end if;
  -- Expiry is DERIVED, never a stored status: always correct, no sweeper.
  if v_session.expires_at <= now() then
    raise exception 'SESSION_EXPIRED';
  end if;

  v_result := public.create_order_with_items(
    v_session.platform,          -- channel from the SESSION, never the client
    p_client_request_id,
    p_order_type,
    p_table_number,
    p_customer_name,
    p_customer_phone,
    p_customer_address,
    p_customer_note,
    p_items);

  -- The session was active, so no order is linked to it yet. A duplicate here
  -- means this requestId was already spent on a DIFFERENT order (e.g. through
  -- the normal /api/order/submit path) — refuse rather than mis-link.
  if (v_result->>'duplicate')::boolean then
    raise exception 'SESSION_REQUEST_ID_REUSED';
  end if;

  v_order_id := (v_result->>'order_id')::uuid;

  update public.bot_sessions
    set status       = 'completed',
        order_id     = v_order_id,
        completed_at = now(),
        updated_at   = now()
    where id = v_session.id;

  return v_result || jsonb_build_object('platform', v_session.platform);
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- § 6. Function permissions — service_role ONLY
-- ════════════════════════════════════════════════════════════════════════════
-- Functions get EXECUTE for PUBLIC by default; strip it. The browser (anon)
-- must never be able to call these, and anon holds no credential that could.

revoke execute on function public.create_bot_session(text, text, text, text, int)
  from public, anon, authenticated;
grant  execute on function public.create_bot_session(text, text, text, text, int)
  to service_role;

revoke execute on function public.create_order_from_bot_session(
  text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.create_order_from_bot_session(
  text, text, text, text, text, text, text, text, jsonb) to service_role;

-- Re-assert 2G-I's grants on the REPLACED function. CREATE OR REPLACE keeps
-- existing grants, but stating them makes this file self-verifying.
revoke execute on function public.create_order_with_items(
  text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.create_order_with_items(
  text, text, text, text, text, text, text, text, jsonb) to service_role;

-- Make PostgREST pick up the new objects immediately.
notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- § 7. Verification (run after; read-only)
-- ════════════════════════════════════════════════════════════════════════════

-- a) Columns:
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'bot_sessions'
  order by ordinal_position;

-- b) Constraints — expect platform_check, external_chat_id_format,
--    token_hash_format, request_id_uuidv4, status_check, completed_needs_order,
--    completed_at_sync, revoked_at_sync, plus the FK and PK:
select conname, pg_get_constraintdef(oid)
  from pg_constraint
  where conrelid = 'public.bot_sessions'::regclass
  order by conname;

-- c) Indexes — expect the 4 named in § 1 plus the PK. NO expires_at index:
select indexname, indexdef from pg_indexes
  where schemaname = 'public' and tablename = 'bot_sessions'
  order by indexname;

-- d) RLS enabled and ZERO policies:
select relname, relrowsecurity from pg_class
  where relnamespace = 'public'::regnamespace and relname = 'bot_sessions';
select count(*) as policy_count from pg_policies
  where schemaname = 'public' and tablename = 'bot_sessions';   -- expect 0

-- e) No anon/authenticated privileges of any kind — expect 0 rows from both:
select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'bot_sessions'
    and grantee in ('anon', 'authenticated');
select grantee, column_name, privilege_type from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'bot_sessions'
    and grantee in ('anon', 'authenticated');

-- f) service_role has SELECT/INSERT/UPDATE and NO DELETE:
select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'bot_sessions'
    and grantee = 'service_role'
  order by privilege_type;

-- g) EXECUTE only for service_role on all three functions — expect NO
--    anon/authenticated/PUBLIC rows:
select routine_name, grantee, privilege_type
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('create_bot_session',
                         'create_order_from_bot_session',
                         'create_order_with_items')
  order by routine_name, grantee;

-- h) All three SECURITY INVOKER with pinned search_path:
select proname, prosecdef as is_security_definer, proconfig
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('create_bot_session',
                    'create_order_from_bot_session',
                    'create_order_with_items');

-- i) No advisory lock leaked (run in a FRESH session, after any call above):
select locktype, objid, mode from pg_locks where locktype = 'advisory';  -- expect 0 rows


-- ════════════════════════════════════════════════════════════════════════════
-- § 8. NORMAL-ORDER REGRESSION (run this; it is the important one)
-- ════════════════════════════════════════════════════════════════════════════
-- Proves § 3 did not change customer/staff behaviour. Creates a REAL order —
-- clean it up. Replace 'A01' with a real, available item_code first:
--   select item_code, name_en, price, availability_status
--     from public.menu_items where availability_status = 'available' limit 5;
--
-- Run TWICE. Expect: the SAME TP- order number both times, "duplicate": false
-- then true, and an "order_id" key present in both responses.
--
-- select public.create_order_with_items(
--   'customer', 'sql-3d-regression-0001', 'dine_in', '99',
--   null, null, null, 'Phase 3D regression — delete me',
--   '[{"item_code":"A01","quantity":1}]'::jsonb);
--
-- Confirm the row looks exactly like a pre-3D customer order:
-- select order_number, source, order_type, table_number, customer_name,
--        subtotal, delivery_fee, total, payment_status
--   from public.orders where client_request_id = 'sql-3d-regression-0001';
--   → expect source='customer_menu', order_number LIKE 'TP-2%' (no IG/MS).
--
-- Cleanup:
-- delete from public.order_items where order_id in
--   (select id from public.orders where client_request_id = 'sql-3d-regression-0001');
-- delete from public.orders where client_request_id = 'sql-3d-regression-0001';


-- ════════════════════════════════════════════════════════════════════════════
-- § 9. BOT-SESSION TEST SQL (single-session behaviour)
-- ════════════════════════════════════════════════════════════════════════════
-- Creates a REAL order — clean it up. The token hash below is a dummy
-- 64-hex string; the real one is sha256 of the app-derived token. Using a
-- dummy here is deliberate: it proves the DB never needs the plaintext.
--
-- 9a. Create a session:
-- select public.create_bot_session(
--   'instagram', 'sql-editor-chat-1',
--   repeat('a', 64), '11111111-2222-4333-8444-555555555555', 24);
--   → expect status 'active', duplicate false.
--
-- 9b. Idempotent replay — SAME request id, SAME chat, SAME hash:
-- (repeat 9a verbatim) → expect the SAME session_id, "duplicate": true.
--
-- 9c. Token-hash mismatch (simulates a rotated BOT_SESSION_TOKEN_SECRET):
-- select public.create_bot_session(
--   'instagram', 'sql-editor-chat-1',
--   repeat('b', 64), '11111111-2222-4333-8444-555555555555', 24);
--   → expect ERROR: SESSION_TOKEN_UNRECOVERABLE (never a session_id).
--
-- 9d. Idempotency key reused across chats:
-- select public.create_bot_session(
--   'instagram', 'sql-editor-chat-DIFFERENT',
--   repeat('a', 64), '11111111-2222-4333-8444-555555555555', 24);
--   → expect ERROR: SESSION_REQUEST_ID_CONFLICT.
--
-- 9e. Rejected inputs — each must raise, none may insert:
-- select public.create_bot_session('whatsapp','c', repeat('a',64),
--   '11111111-2222-4333-8444-555555555556', 24);          -- SESSION_BAD_PLATFORM
-- select public.create_bot_session('instagram','bad chat!', repeat('a',64),
--   '11111111-2222-4333-8444-555555555556', 24);          -- SESSION_BAD_CHAT_ID
-- select public.create_bot_session('instagram','c', 'nothex',
--   '11111111-2222-4333-8444-555555555556', 24);          -- SESSION_BAD_TOKEN
-- select public.create_bot_session('instagram','c', repeat('a',64),
--   'not-a-uuid', 24);                                    -- SESSION_BAD_REQUEST_ID
-- select public.create_bot_session('instagram','c', repeat('a',64),
--   '11111111-2222-1333-8444-555555555556', 24);   -- v1 UUID → SESSION_BAD_REQUEST_ID
-- select public.create_bot_session('instagram','c', repeat('a',64),
--   '11111111-2222-4333-8444-555555555556', 999);         -- SESSION_BAD_TTL
--
-- 9f. Checkout consumes the session:
-- select public.create_order_from_bot_session(
--   repeat('a', 64), 'sql-3d-order-0001', 'pickup', null,
--   'SQL Test', '0800000000', null, 'Phase 3D dry run — delete me',
--   '[{"item_code":"A01","quantity":1}]'::jsonb);
--   → expect a TP-IG-… order number and "platform": "instagram".
-- select status, order_id, completed_at from public.bot_sessions
--   where token_hash = repeat('a', 64);
--   → expect 'completed', order_id set, completed_at set (all three).
--
-- 9g. Idempotent checkout retry — SAME client_request_id:
-- (repeat 9f verbatim) → expect the SAME order number, "duplicate": true.
--
-- 9h. SECOND checkout with a DIFFERENT client_request_id:
-- select public.create_order_from_bot_session(
--   repeat('a', 64), 'sql-3d-order-0002', 'pickup', null,
--   'SQL Test', '0800000000', null, null,
--   '[{"item_code":"A01","quantity":1}]'::jsonb);
--   → expect ERROR: SESSION_COMPLETED. Then confirm NO second order exists:
-- select count(*) from public.orders where client_request_id = 'sql-3d-order-0002';
--   → expect 0.
--
-- 9i. REVOKED path — self-contained, run top to bottom.
--     Uses its own chat id so it cannot collide with 9a-9h's active session
--     (bot_sessions_one_active_per_chat allows only one active row per chat).
--
--     i-1. Seed. Expected state after this: exactly one row for this chat,
--          status 'active', revoked_at null.
-- select public.create_bot_session(
--   'instagram', 'sql-editor-chat-revoked',
--   repeat('c', 64), '33333333-3333-4333-8333-333333333333', 24);
-- select status, revoked_at from public.bot_sessions
--   where token_hash = repeat('c', 64);          -- expect ('active', null)
--
--     i-2. Revoke it. (In production this happens automatically when a NEWER
--          session is created for the same chat — see § 10 C3. The direct
--          UPDATE here just isolates the checkout behaviour.)
-- update public.bot_sessions set status='revoked', revoked_at=now(), updated_at=now()
--   where token_hash = repeat('c', 64);
-- select status, revoked_at from public.bot_sessions
--   where token_hash = repeat('c', 64);          -- expect ('revoked', <timestamp>)
--
--     i-3. Checkout must be refused, and NO order may be created.
-- select public.create_order_from_bot_session(
--   repeat('c', 64), 'sql-3d-order-revoked', 'pickup', null,
--   'SQL Test', '0800000000', null, null,
--   '[{"item_code":"A01","quantity":1}]'::jsonb);
--   → expect ERROR: SESSION_REVOKED
-- select count(*) from public.orders where client_request_id = 'sql-3d-order-revoked';
--   → expect 0.
--
-- 9i-b. EXPIRED path — self-contained, own chat id.
--
--     Note the TTL is still 24 h at creation; expiry is forced by moving
--     expires_at into the past, because the function DERIVES expiry from
--     expires_at rather than storing an 'expired' status.
-- select public.create_bot_session(
--   'messenger', 'sql-editor-chat-expired',
--   repeat('d', 64), '44444444-4444-4444-8444-444444444444', 24);
-- select status, expires_at > now() as not_yet_expired from public.bot_sessions
--   where token_hash = repeat('d', 64);          -- expect ('active', true)
--
-- update public.bot_sessions set expires_at = now() - interval '1 minute',
--                                updated_at = now()
--   where token_hash = repeat('d', 64);
-- select status, expires_at > now() as not_yet_expired from public.bot_sessions
--   where token_hash = repeat('d', 64);          -- expect ('active', false)
--
-- select public.create_order_from_bot_session(
--   repeat('d', 64), 'sql-3d-order-expired', 'pickup', null,
--   'SQL Test', '0800000000', null, null,
--   '[{"item_code":"A01","quantity":1}]'::jsonb);
--   → expect ERROR: SESSION_EXPIRED
-- select count(*) from public.orders where client_request_id = 'sql-3d-order-expired';
--   → expect 0.
--
-- 9j. Unknown token:
-- select public.create_order_from_bot_session(repeat('f', 64), 'sql-3d-order-0003',
--   'pickup', null, 'X', '0800000000', null, null,
--   '[{"item_code":"A01","quantity":1}]'::jsonb);
--   → expect ERROR: SESSION_INVALID.
--
-- ── § 9 CLEANUP (FK-safe order: bot_sessions.order_id references orders with
--    ON DELETE RESTRICT, so the SESSIONS must be deleted FIRST — deleting the
--    orders first is refused by the foreign key) ──
--    Covers every chat id used above: sql-editor-chat-1, -revoked, -expired.
-- delete from public.bot_sessions where external_chat_id like 'sql-editor-chat%';
-- delete from public.order_items where order_id in
--   (select id from public.orders where client_request_id like 'sql-3d-order-%');
-- delete from public.orders where client_request_id like 'sql-3d-order-%';
-- -- verify nothing is left behind:
-- select count(*) as leftover_sessions from public.bot_sessions
--   where external_chat_id like 'sql-editor-chat%';          -- expect 0
-- select count(*) as leftover_orders from public.orders
--   where client_request_id like 'sql-3d-order-%';           -- expect 0


-- ════════════════════════════════════════════════════════════════════════════
-- § 10. CONCURRENCY TESTS — two real sessions required
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ NEVER run these against Production. Use a Supabase branch or a staging
-- project. They need TWO simultaneous connections (two psql windows, or two
-- SQL Editor tabs will NOT work — the editor autocommits per statement).
--
-- C1. SAME request id, concurrent (proves the advisory lock + idempotency)
--   Session 1:  begin;
--               select public.create_bot_session('instagram','conc-1',
--                 repeat('a',64), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 24);
--               -- do NOT commit yet
--   Session 2:  begin;
--               select public.create_bot_session('instagram','conc-1',
--                 repeat('a',64), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 24);
--               -- EXPECT: this statement BLOCKS on pg_advisory_xact_lock
--   Session 1:  commit;
--   Session 2:  -- unblocks, returns the SAME session_id, "duplicate": true
--               commit;
--   Verify:     select count(*) from public.bot_sessions
--                 where request_id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
--               → EXPECT EXACTLY 1.
--
-- C2. DIFFERENT request ids, NO prior active session (the case the pre-lock
--     design broke on — the second INSERT hit the unique index with an
--     unmapped error)
--   Ensure no active row: select * from public.bot_sessions
--     where platform='instagram' and external_chat_id='conc-2' and status='active';
--   Session 1:  begin; select public.create_bot_session('instagram','conc-2',
--                 repeat('1',64), '11111111-1111-4111-8111-111111111111', 24);
--   Session 2:  begin; select public.create_bot_session('instagram','conc-2',
--                 repeat('2',64), '22222222-2222-4222-8222-222222222222', 24);
--               -- EXPECT: BLOCKS
--   Session 1:  commit;
--   Session 2:  -- unblocks, SUCCEEDS with its own new session; commit;
--   Verify:     select status, count(*) from public.bot_sessions
--                 where external_chat_id='conc-2' group by status;
--               → EXPECT exactly one 'active' (session 2's) and one 'revoked'
--                 (session 1's, revoked by session 2). NEITHER call errored.
--
-- C3. DIFFERENT request ids, WITH a prior active session
--   Seed (single connection, commits normally). Expected state after: exactly
--   one row for chat 'conc-3', status 'active'.
--   select public.create_bot_session('instagram','conc-3',
--     repeat('3',64), '33333333-cccc-4333-8333-333333333333', 24);
--   select status, count(*) from public.bot_sessions
--     where external_chat_id='conc-3' group by status;   -- expect active=1
--
--   Session 1:  begin; select public.create_bot_session('instagram','conc-3',
--                 repeat('4',64), '44444444-cccc-4444-8444-444444444444', 24);
--   Session 2:  begin; select public.create_bot_session('instagram','conc-3',
--                 repeat('5',64), '55555555-cccc-4555-8555-555555555555', 24);
--               -- EXPECT: BLOCKS on the advisory lock
--   Session 1:  commit;
--   Session 2:  -- unblocks, revokes session 1's row, succeeds; commit;
--   Verify:     select status, count(*) from public.bot_sessions
--                 where external_chat_id='conc-3' group by status;
--               → EXPECT exactly one 'active' (the last committer) and TWO
--                 'revoked' (the seed + session 1's). No caller errored.
--
-- C4. Advisory lock released on COMMIT and on ROLLBACK
--   Expected state before: no row for chat 'conc-4'.
--   select count(*) from public.bot_sessions where external_chat_id='conc-4';
--     → expect 0.
--
--   C4-a ROLLBACK releases the lock:
--   Session 1:  begin;
--               select public.create_bot_session('instagram','conc-4',
--                 repeat('6',64), '66666666-cccc-4666-8666-666666666666', 24);
--               rollback;
--   Session 2:  select locktype, objid, mode from pg_locks
--                 where locktype='advisory';   → EXPECT 0 rows
--   Verify:     select count(*) from public.bot_sessions
--                 where external_chat_id='conc-4';   → EXPECT 0 (rolled back)
--
--   C4-b The next caller must not block on a stale lock:
--   Session 2:  select public.create_bot_session('instagram','conc-4',
--                 repeat('7',64), '77777777-cccc-4777-8777-777777777777', 24);
--               → EXPECT: returns immediately, status 'active', duplicate false.
--   Session 2:  select locktype, objid, mode from pg_locks
--                 where locktype='advisory';   → EXPECT 0 rows (committed too)
--
-- C5. Concurrent CHECKOUT on ONE session creates exactly ONE order
--   Seed (single connection, commits normally). Expected state after: one row
--   for chat 'conc-5', status 'active', order_id null, completed_at null.
--   select public.create_bot_session('messenger','conc-5',
--     repeat('e',64), '88888888-cccc-4888-8888-888888888888', 24);
--   select status, order_id, completed_at, expires_at > now() as live
--     from public.bot_sessions where token_hash = repeat('e',64);
--     → expect ('active', null, null, true)
--
--   Session 1:  begin;
--               select public.create_order_from_bot_session(repeat('e',64),
--                 'conc-order-A', 'pickup', null, 'A', '0800000001', null, null,
--                 '[{"item_code":"A01","quantity":1}]'::jsonb);
--   Session 2:  begin;
--               select public.create_order_from_bot_session(repeat('e',64),
--                 'conc-order-B', 'pickup', null, 'B', '0800000002', null, null,
--                 '[{"item_code":"A01","quantity":1}]'::jsonb);
--               -- EXPECT: BLOCKS on the SELECT ... FOR UPDATE
--   Session 1:  commit;
--   Session 2:  -- unblocks and FAILS with SESSION_COMPLETED; rollback;
--   Verify:     select count(*) from public.orders
--                 where client_request_id in ('conc-order-A','conc-order-B');
--               → EXPECT EXACTLY 1.
--   Also confirm the session was consumed exactly once:
--   select status, order_id is not null as has_order, completed_at is not null
--     from public.bot_sessions where token_hash = repeat('e',64);
--     → expect ('completed', true, true)
--   ⚠️ THIS IS THE SINGLE HIGHEST-VALUE TEST IN THE MATRIX. No unit test can
--      prove it; the whole "one link, one order" rule rests on it.
--
-- ── § 10 CLEANUP (FK-safe order: sessions reference orders ON DELETE RESTRICT,
--    so bot_sessions rows MUST go first or the order delete is refused) ──
-- delete from public.bot_sessions where external_chat_id like 'conc-%';
-- delete from public.order_items where order_id in
--   (select id from public.orders where client_request_id like 'conc-order-%');
-- delete from public.orders where client_request_id like 'conc-order-%';
-- -- verify nothing is left behind:
-- select count(*) as leftover_sessions from public.bot_sessions
--   where external_chat_id like 'conc-%';                    -- expect 0
-- select count(*) as leftover_orders from public.orders
--   where client_request_id like 'conc-order-%';             -- expect 0


-- ════════════════════════════════════════════════════════════════════════════
-- § 11. ROLLBACK (commented out — copy lines out to use)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ APP FIRST. Revert/redeploy the Phase 3D app commit BEFORE running any of
-- this. The routes call these RPCs; dropping them under a live deploy turns
-- every secure link into a 500. The forward order (SQL → deploy) and the
-- rollback order (revert → SQL) are ASYMMETRIC. Getting it backwards causes a
-- live outage on the secure-link route.
--
-- ⚠️ DATA LOSS: § 11.3 destroys every bot_sessions row. Sessions are ephemeral
-- (24 h) so this is normally acceptable, but THE ORDER↔CHAT LINK IS
-- UNRECOVERABLE: afterwards you can still see WHICH orders came from a bot
-- (orders.source = 'instagram'/'messenger' is untouched) but no longer FROM
-- WHICH CONVERSATION. If that attribution matters, export first:
--   select id, platform, external_chat_id, order_id, status,
--          created_at, completed_at, revoked_at
--     from public.bot_sessions order by created_at;
--
-- ⚠️ NOT ROLLED BACK, DELIBERATELY: orders already created with source
-- 'instagram'/'messenger' are REAL orders and are left exactly as they are.
-- § 11.2 re-narrows the function so no NEW ones can be created; it does not
-- and must not rewrite history. Existing rows keep mapping correctly through
-- SOURCE_TO_CHANNEL in api/_lib/orderDetails.server.ts, which already knew
-- those two source values before this phase.
--
-- 11.1 Drop the new functions (safe once the app is reverted):
-- drop function if exists public.create_order_from_bot_session(
--   text, text, text, text, text, text, text, text, jsonb);
-- drop function if exists public.create_bot_session(text, text, text, text, int);
--
-- 11.2 Restore create_order_with_items to its 2G-I body:
--   Copy § 2 of docs/sql/2026-07-14-2G-I-order-intake.sql VERBATIM, run it,
--   then re-run that file's § 3 grant block. This removes the
--   instagram/messenger branches AND the 'order_id' return key. Safe: no
--   2G-I-era caller ever read order_id.
--   ⚠️ THAT FILE MUST STAY IN THE REPO — it is the canonical prior body.
--   PARTIAL ROLLBACK IS ALSO VALID and is the safer default: leaving the
--   extended function in place is harmless once create_order_from_bot_session
--   is gone, because no route passes a bot channel. Prefer this if you may
--   roll forward again soon.
--
-- 11.3 Drop the table (indexes and constraints go with it). ON DELETE
--      RESTRICT points session→order, so this cannot cascade into orders:
-- drop table if exists public.bot_sessions;
--
-- notify pgrst, 'reload schema';
--
-- 11.4 Verify the rollback — expect null, then 0 rows, then a clean § 8:
-- select to_regclass('public.bot_sessions') as should_be_null;
-- select proname from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('create_bot_session', 'create_order_from_bot_session');
-- (then re-run § 8 to confirm normal intake still works)
