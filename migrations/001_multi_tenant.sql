-- Multi-tenant migration for LocalPrint-online.
-- Run this once against the Supabase Postgres database (SQL Editor, or
-- `psql "$DATABASE_URL" -f migrations/001_multi_tenant.sql`) before deploying
-- the multi-tenant server code.

begin;

create table if not exists shops (
  id text primary key,
  slug text not null unique,
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

alter table settings add column if not exists shop_id text;
alter table paper_types add column if not exists shop_id text;
alter table discount_rules add column if not exists shop_id text;
alter table orders add column if not exists shop_id text;

-- Backfill: if pre-existing single-tenant rows have no shop_id yet, create a
-- "default" shop and assign it to them so nothing already in production is
-- orphaned. The default shop's token is intentionally NOT set here — run
-- `node scripts/create-shop.js "Default Shop" --slug default` (or update the
-- row directly) to mint a real token for it if you intend to keep using it.
do $$
declare
  needs_default boolean;
begin
  select exists(
    select 1 from settings where shop_id is null
    union all
    select 1 from paper_types where shop_id is null
    union all
    select 1 from discount_rules where shop_id is null
    union all
    select 1 from orders where shop_id is null
  ) into needs_default;

  if needs_default then
    insert into shops (id, slug, name, token_hash)
    values ('default', 'default', 'Default Shop', 'unset-' || gen_random_uuid()::text)
    on conflict (id) do nothing;

    update settings set shop_id = 'default' where shop_id is null;
    update paper_types set shop_id = 'default' where shop_id is null;
    update discount_rules set shop_id = 'default' where shop_id is null;
    update orders set shop_id = 'default' where shop_id is null;
  end if;
end $$;

alter table settings alter column shop_id set not null;
alter table paper_types alter column shop_id set not null;
alter table discount_rules alter column shop_id set not null;
alter table orders alter column shop_id set not null;

-- settings was previously keyed by `key` alone; it must now be unique per shop.
alter table settings drop constraint if exists settings_key_key;
alter table settings drop constraint if exists settings_pkey;
create unique index if not exists settings_shop_id_key_idx on settings (shop_id, key);

create index if not exists paper_types_shop_id_idx on paper_types (shop_id);
create index if not exists discount_rules_shop_id_idx on discount_rules (shop_id);
create index if not exists orders_shop_id_idx on orders (shop_id);
create index if not exists orders_shop_id_shopsyncstatus_idx on orders (shop_id, shopsyncstatus);

commit;
