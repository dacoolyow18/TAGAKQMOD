-- These operational records are accessed through the branch-scoped server API.
DO $$
DECLARE
  relation_name text;
  browser_role text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['order_state_transitions', 'shift_reconciliations', 'audit_events']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', relation_name);
    FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
    LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', relation_name, browser_role);
    END LOOP;
  END LOOP;
END $$;
