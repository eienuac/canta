-- ROLLBACK 009 — removes the order transition guard. Non-destructive (no data changes).
-- Run this FIRST if the application has to be rolled back to the version before PR #6:
-- that version marks orders as payment_received before committing stock, which 009 rejects.
drop trigger if exists orders_transition_guard on public.orders;
drop function if exists public.orders_transition_guard();
