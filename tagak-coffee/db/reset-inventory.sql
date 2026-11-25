-- Read-only preflight. Run against the confirmed database before planning a reset.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database() AS database_name, current_user AS database_role;
SELECT id, email, role, active, branch_id, password_hash IS NOT NULL AS has_password
FROM public.accounts WHERE role = 'Super Admin';
SELECT role, permissions FROM public.role_permissions ORDER BY role;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;
SELECT 'accounts excluding Super Admin' AS resource, count(*) AS records
FROM public.accounts WHERE role <> 'Super Admin'
UNION ALL SELECT 'sessions', count(*) FROM public.sessions
UNION ALL SELECT 'branches', count(*) FROM public.branches
UNION ALL SELECT 'orders', count(*) FROM public.orders
UNION ALL SELECT 'menu_items', count(*) FROM public.menu_items
UNION ALL SELECT 'menu_item_recipes', count(*) FROM public.menu_item_recipes
UNION ALL SELECT 'add_ons', count(*) FROM public.add_ons
UNION ALL SELECT 'add_on_supplies', count(*) FROM public.add_on_supplies
UNION ALL SELECT 'supplies', count(*) FROM public.supplies
UNION ALL SELECT 'supply_price_logs', count(*) FROM public.supply_price_logs
UNION ALL SELECT 'cash_logs', count(*) FROM public.cash_logs
UNION ALL SELECT 'carousel_images', count(*) FROM public.carousel_images
UNION ALL SELECT 'settings', count(*) FROM public.settings
UNION ALL SELECT 'ticket_counters', count(*) FROM public.ticket_counters
UNION ALL SELECT 'payrex_checkouts', count(*) FROM public.payrex_checkouts
UNION ALL SELECT 'xendit_checkouts', count(*) FROM public.xendit_checkouts
UNION ALL SELECT 'request_attempts', count(*) FROM public.request_attempts
UNION ALL SELECT 'oauth_states', count(*) FROM public.oauth_states
UNION ALL SELECT 'media_uploads', count(*) FROM public.media_uploads;
SELECT public_url FROM public.carousel_images ORDER BY public_url;
ROLLBACK;
