-- Job review step: lets a shop reject a fetched-but-unclaimed cloud order
-- instead of only accepting (auto-ack) it. Run this once against the Supabase
-- Postgres database (SQL Editor, or `psql "$DATABASE_URL" -f
-- migrations/003_job_review.sql`).

begin;

alter table orders add column if not exists rejection_reason text;

commit;

-- `status` is written as free-form text elsewhere in this app (e.g. 'PENDING',
-- 'PRINTED') with no CHECK constraint found in the existing schema, so
-- 'rejected' should already be a valid value with nothing further to do. If
-- you DO have a CHECK constraint on orders.status, this query will show it:
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'orders'::regclass and contype = 'c';
--
-- If it returns a row restricting the allowed values, drop and recreate it
-- with 'rejected' added, e.g.:
--
--   alter table orders drop constraint <conname_from_above>;
--   alter table orders add constraint orders_status_check
--     check (status in ('PENDING', 'READY', 'PRINTED', 'rejected'));
