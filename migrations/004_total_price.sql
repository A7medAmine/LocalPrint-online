-- Store the customer-quoted price on each order so past-uploads views don't
-- need to refetch shop settings + recompute client-side.
-- Existing rows stay NULL; the client will fall back to on-the-fly compute
-- for those.

alter table orders add column if not exists total_price numeric;
