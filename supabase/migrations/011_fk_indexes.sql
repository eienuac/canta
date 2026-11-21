-- 011 — Foreign-key indexes
--
-- Indexes on foreign-key columns that are filtered or joined on (orders by customer,
-- items/payments by order, carts by customer, returns, coupon usage). Tables are small today,
-- so these are for growth: lookups stay index scans as orders accumulate.
-- Plain CREATE INDEX (not CONCURRENTLY) is fine at the current table sizes.

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_cart_id_idx on public.orders (cart_id);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists payments_order_id_idx on public.payments (order_id);
create index if not exists carts_user_id_idx on public.carts (user_id);
create index if not exists coupon_usages_coupon_id_idx on public.coupon_usages (coupon_id);
create index if not exists coupon_usages_user_id_idx on public.coupon_usages (user_id);
create index if not exists return_requests_user_id_idx on public.return_requests (user_id);
create index if not exists return_requests_order_id_idx on public.return_requests (order_id);
create index if not exists return_items_return_request_id_idx on public.return_items (return_request_id);
create index if not exists return_items_order_item_id_idx on public.return_items (order_item_id);
create index if not exists reviews_order_id_idx on public.reviews (order_id);
