-- =====================================================================
-- 001_init.sql — core schema
-- Authorization model: the application connects with a single privileged
-- database role and enforces permissions in the server-side services layer.
-- Row Level Security is enabled on every table with NO policies, so the
-- Supabase `anon` / `authenticated` API roles cannot read or write anything
-- directly. Integrity rules (append-only ledger, non-negative balances,
-- "approved requires verified values", duplicate prevention) live in the
-- database itself.
-- =====================================================================

-- ---------- users & auth ----------
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  username text not null,
  password_hash text,
  role text not null default 'user' check (role in ('user', 'admin')),
  -- fine-grained admin permissions: review_applications, manage_tasks,
  -- manage_users, wallet_adjust, manage_settings
  permissions text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'suspended')),
  suspension_reason text,
  email_verified_at timestamptz,
  verification_code text not null,           -- public code a user may place in their Reddit bio to prove ownership
  is_test_data boolean not null default false,
  deletion_requested_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_format check (position('@' in email) > 1 and length(email) <= 254),
  constraint users_username_format check (username ~ '^[A-Za-z0-9_]{3,24}$')
);
create unique index users_email_lower_uq on users (lower(email));
create unique index users_username_lower_uq on users (lower(username));
create index users_role_idx on users (role) where role = 'admin';

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

create table auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify_email', 'reset_password')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_tokens_user_idx on auth_tokens (user_id, kind);

create table rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 1
);

-- ---------- platform configuration ----------
create table platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table content_pages (
  slug text primary key,
  title text not null,
  body text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index task_categories_name_uq on task_categories (lower(name));

-- ---------- reddit account submissions ----------
create table reddit_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  profile_url text not null,
  reddit_username text not null check (reddit_username ~ '^[A-Za-z0-9_-]{3,20}$'),
  status text not null default 'Pending Verification' check (status in (
    'Pending Verification', 'Pending Admin Review', 'Approved', 'Rejected', 'Needs More Information', 'Suspended'
  )),
  verification_state text not null default 'unverified'
    check (verification_state in ('verified', 'unverified', 'manual_review_required')),
  ownership_state text not null default 'not_checked'
    check (ownership_state in ('confirmed', 'not_confirmed', 'not_checked')),
  values_source text check (values_source in ('reddit_api', 'admin_manual', 'test_fixture')),
  account_created_at timestamptz,
  comment_karma integer check (comment_karma >= 0),
  post_karma integer check (post_karma >= 0),
  verified_at timestamptz,
  user_note text,
  rejection_reason text,
  allow_resubmit boolean not null default true,
  info_request text,
  suspension_reason text,
  admin_notes text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  superseded_at timestamptz,
  -- verified values are all-or-nothing and always carry a source
  constraint rs_values_complete check (
    (values_source is null and account_created_at is null and comment_karma is null and post_karma is null)
    or (values_source is not null and account_created_at is not null and comment_karma is not null and post_karma is not null)
  ),
  -- a submission can only be Approved with fully verified values
  constraint rs_approved_requires_values check (
    status <> 'Approved' or (verification_state = 'verified' and values_source is not null)
  )
);
-- one current submission per user
create unique index rs_one_current_per_user on reddit_submissions (user_id) where superseded_at is null;
-- the same Reddit account cannot be actively claimed by two platform users
create unique index rs_one_active_per_reddit_name on reddit_submissions (lower(reddit_username))
  where superseded_at is null and status in ('Pending Verification', 'Pending Admin Review', 'Approved', 'Needs More Information', 'Suspended');
create index rs_status_idx on reddit_submissions (status, submitted_at) where superseded_at is null;
create index rs_user_idx on reddit_submissions (user_id, submitted_at desc);

create table verification_records (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references reddit_submissions(id) on delete cascade,
  method text not null check (method in ('reddit_api', 'admin_manual', 'test_fixture')),
  outcome text not null check (outcome in ('verified', 'unverified', 'manual_review_required')),
  failure_code text,
  detail text,
  reddit_username text,
  account_created_at timestamptz,
  comment_karma integer,
  post_karma integer,
  ownership_state text not null default 'not_checked' check (ownership_state in ('confirmed', 'not_confirmed', 'not_checked')),
  checks jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  checked_by uuid,
  created_at timestamptz not null default now()
);
create index vr_submission_idx on verification_records (submission_id, created_at desc);

create table review_decisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references reddit_submissions(id) on delete cascade,
  admin_id uuid,
  action text not null check (action in (
    'approve', 'reject', 'request_info', 'mark_manual', 'suspend', 'reinstate', 'auto_reject', 'manual_values', 'note'
  )),
  from_status text,
  to_status text,
  reason text,
  created_at timestamptz not null default now()
);
create index rd_submission_idx on review_decisions (submission_id, created_at desc);

-- ---------- subreddits, tasks, task applications ----------
create table subreddits (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '^[A-Za-z0-9_]{2,21}$'),
  category_id uuid not null references task_categories(id) on delete restrict,
  description text not null default '',
  restrictions text not null default '',
  extra_requirements text not null default '',
  active boolean not null default true,
  min_account_age_months integer not null default 0 check (min_account_age_months between 0 and 240),
  min_comment_karma integer not null default 0 check (min_comment_karma >= 0),
  min_post_karma integer not null default 0 check (min_post_karma >= 0),
  requires_manual_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subreddits_name_uq on subreddits (lower(name));

create table tasks (
  id uuid primary key default gen_random_uuid(),
  subreddit_id uuid not null references subreddits(id) on delete restrict,
  category_id uuid not null references task_categories(id) on delete restrict,
  title text not null check (length(trim(title)) between 3 and 120),
  description text not null default '',
  instructions text not null default '',
  reward_paise bigint check (reward_paise is null or (reward_paise >= 0 and reward_paise <= 100000000000)),
  active boolean not null default true,
  allow_repeat boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_subreddit_idx on tasks (subreddit_id);
create index tasks_active_idx on tasks (active, created_at desc);

create table task_applications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete restrict,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'Applied' check (status in (
    'Applied', 'Under Review', 'Accepted', 'Rejected', 'Completed', 'Cancelled'
  )),
  user_note text,
  admin_note text,
  decided_by uuid,
  decided_at timestamptz,
  reward_credited_paise bigint,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- never more than one OPEN application per user per task
create unique index ta_one_open_per_task_user on task_applications (task_id, user_id)
  where status in ('Applied', 'Under Review', 'Accepted');
create index ta_user_idx on task_applications (user_id, created_at desc);
create index ta_status_idx on task_applications (status, created_at);

-- ---------- wallet (internal ledger only; no payment rails) ----------
create table wallets (
  user_id uuid primary key references users(id) on delete cascade,
  available_paise bigint not null default 0 check (available_paise >= 0),
  total_earned_paise bigint not null default 0 check (total_earned_paise >= 0),
  updated_at timestamptz not null default now()
);

create table wallet_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete restrict,
  direction text not null check (direction in ('credit', 'debit')),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  kind text not null check (kind in ('task_reward', 'admin_adjustment')),
  status text not null default 'posted' check (status = 'posted'),
  description text not null check (length(trim(description)) >= 3),
  reference_type text,
  reference_id text,
  idempotency_key text unique,
  created_by uuid,
  balance_after_paise bigint,
  created_at timestamptz not null default now()
);
create index wl_user_idx on wallet_ledger (user_id, id desc);

-- ---------- notifications & audit ----------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_label text not null default 'system',
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_created_idx on audit_logs (created_at desc);
create index audit_target_idx on audit_logs (target_type, target_id);

-- =====================================================================
-- Ledger integrity: balances can only change through ledger inserts.
-- =====================================================================
create function wallet_ledger_apply() returns trigger language plpgsql as $$
declare
  cur bigint;
  new_bal bigint;
begin
  insert into wallets (user_id) values (new.user_id) on conflict (user_id) do nothing;
  select available_paise into cur from wallets where user_id = new.user_id for update;
  if new.direction = 'credit' then
    new_bal := cur + new.amount_paise;
  else
    new_bal := cur - new.amount_paise;
  end if;
  if new_bal < 0 then
    raise exception 'insufficient_balance' using errcode = 'P0001';
  end if;
  update wallets
     set available_paise = new_bal,
         total_earned_paise = total_earned_paise
           + case when new.kind = 'task_reward' and new.direction = 'credit' then new.amount_paise else 0 end,
         updated_at = now()
   where user_id = new.user_id;
  new.balance_after_paise := new_bal;
  return new;
end $$;
create trigger wallet_ledger_apply_bi before insert on wallet_ledger
  for each row execute function wallet_ledger_apply();

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;
create trigger wallet_ledger_append_only before update or delete on wallet_ledger
  for each row execute function forbid_mutation();
create trigger wallet_ledger_no_truncate before truncate on wallet_ledger
  for each statement execute function forbid_mutation();
create trigger audit_logs_append_only before update or delete on audit_logs
  for each row execute function forbid_mutation();
create trigger audit_logs_no_truncate before truncate on audit_logs
  for each statement execute function forbid_mutation();

-- a wallet balance can never be edited directly, only via the ledger trigger
create function wallets_guard() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'wallet balances can only change through wallet_ledger' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger wallets_guard_bu before update of available_paise, total_earned_paise on wallets
  for each row execute function wallets_guard();

create function wallets_guard_insert() returns trigger language plpgsql as $$
begin
  if new.available_paise <> 0 or new.total_earned_paise <> 0 then
    raise exception 'wallets must be created empty; balances come from wallet_ledger' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger wallets_guard_bi before insert on wallets
  for each row execute function wallets_guard_insert();

-- =====================================================================
-- Default configuration (values only; no sample users, subreddits or tasks)
-- =====================================================================
insert into platform_settings (key, value) values
  ('site_name', '"Subdesk"'),
  ('support_email', '""'),
  ('min_account_age_months', '3'),
  ('min_comment_karma', '100'),
  ('min_post_karma', '100'),
  ('applications_open', 'true'),
  ('task_applications_open', 'true'),
  ('auto_reject_below_minimums', 'false'),
  ('require_ownership_code', 'true'),
  ('wallet_adjustments_enabled', 'true'),
  ('announcement_enabled', 'false'),
  ('announcement_text', '""');

insert into task_categories (name) values ('General');

insert into content_pages (slug, title, body) values
  ('privacy', 'Privacy Policy',
E'## Placeholder — edit before launch\nThis is placeholder text. Replace it with your real Privacy Policy from the admin panel (Settings → Legal pages) before you launch.\n\n## What we collect\nAccount details (email, username), the Reddit profile you submit, the Reddit account age and karma values used for eligibility, task activity, and wallet records.\n\n## What we do not collect\nWe never ask for your Reddit password. We do not collect payment details.\n\n## Your choices\nYou can request deletion of your account from Settings. Some records may be kept where there is a legitimate reason to retain them.'),
  ('terms', 'Terms of Service',
E'## Placeholder — edit before launch\nThis is placeholder text. Replace it with your real Terms of Service from the admin panel (Settings → Legal pages) before you launch.\n\n## Eligibility\nAccess to tasks requires meeting the published minimum requirements and approval by the platform administrator. Meeting the minimums does not guarantee approval.\n\n## Wallet\nThe wallet is an internal record of balances. Withdrawals and payments are not currently available.\n\n## Conduct\nSubmit only Reddit accounts that you own and control. Accounts may be suspended for abuse.');

-- =====================================================================
-- Lock the table API down for Supabase-style public roles (if present).
-- =====================================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    revoke all on all functions in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
    revoke all on all functions in schema public from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
  end if;
end $$;
