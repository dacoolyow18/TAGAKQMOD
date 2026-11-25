-- Direct database connections serve Tagak. Browser roles have no application-table policies.
DO $$
DECLARE
  relation_name text;
  browser_role text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'accounts','branches','role_permissions','sessions','menu_items','supplies',
    'supply_price_logs','menu_item_recipes','add_ons','cash_logs','carousel_images',
    'settings','ticket_counters','orders','add_on_supplies','payrex_checkouts',
    'xendit_checkouts','request_attempts','oauth_states','media_uploads','schema_migrations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', relation_name);
    FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', relation_name, browser_role);
    END LOOP;
  END LOOP;

  REVOKE ALL ON SEQUENCE public.request_attempts_id_seq FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.primary_branch_id() FROM PUBLIC;
  FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.request_attempts_id_seq FROM %I', browser_role);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.primary_branch_id() FROM %I', browser_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', browser_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', browser_role);
  END LOOP;
END $$;
