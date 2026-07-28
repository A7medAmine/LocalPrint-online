-- Optional customer accounts (Supabase Auth) for LocalPrint-online.
-- Run this once against the Supabase Postgres database (SQL Editor, or
-- `psql "$DATABASE_URL" -f migrations/002_customer_accounts.sql`).
--
-- Accounts are global across the platform (one login works for uploading to
-- any shop) — this does NOT touch the existing shop_id scoping added in
-- 001_multi_tenant.sql, and does not affect guest (unauthenticated) uploads.

begin;

-- One row per Supabase Auth user. `id` is shared with auth.users(id), so a
-- profile is created the first time a customer's profile is read or saved
-- (handled in the backend via upsert) — no trigger required.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  email text,
  default_paper_type_id text,
  default_copies integer,
  created_at timestamptz not null default now()
);

-- Nullable — guest uploads (the default) leave this null and are unaffected.
alter table orders add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists orders_user_id_idx on orders (user_id);

-- RLS is defense-in-depth for any future direct-from-browser Supabase calls
-- (anon key + user JWT). The existing Express backend always uses the
-- service_role key, which bypasses RLS entirely, so none of this changes
-- current guest-upload or shop-sync behavior.
alter table profiles enable row level security;

create policy "Users can view own profile" on profiles
  for select using (auth.uid() = id);

create policy "Users can insert own profile" on profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Orders already only exist via the service-role backend (no prior RLS), so
-- turning RLS on here is additive: it opens a narrow read path for a
-- customer to see their own cross-shop order history via user_id, on top of
-- the existing shop-scoped access the backend already enforces at the
-- application layer with the service_role key.
alter table orders enable row level security;

create policy "Customers can view their own orders" on orders
  for select using (auth.uid() = user_id);

commit;
