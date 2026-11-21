-- Rollback for 011: drops the foreign-key indexes. Non-destructive.

drop index if exists public.orders_user_id_idx;
drop index if exists public.orders_cart_id_idx;
drop index if exists public.order_items_order_id_idx;
drop index if exists public.payments_order_id_idx;
drop index if exists public.carts_user_id_idx;
drop index if exists public.coupon_usages_coupon_id_idx;
drop index if exists public.coupon_usages_user_id_idx;
drop index if exists public.return_requests_user_id_idx;
drop index if exists public.return_requests_order_id_idx;
drop index if exists public.return_items_return_request_id_idx;
drop index if exists public.return_items_order_item_id_idx;
drop index if exists public.reviews_order_id_idx;
