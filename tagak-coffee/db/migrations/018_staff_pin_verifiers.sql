-- The migration runner transforms existing PINs using the server-only key in
-- this transaction, before validating the new constraint and committing.
ALTER TABLE accounts RENAME COLUMN pin TO pin_digest;
ALTER TABLE accounts DROP CONSTRAINT accounts_pin_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_pin_digest_check
  CHECK (pin_digest IS NULL OR pin_digest ~ '^[0-9a-f]{64}$') NOT VALID;

CREATE FUNCTION invalidate_changed_account_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (NEW.role, NEW.pin_digest, NEW.password_hash, NEW.active, NEW.branch_id, NEW.email)
      IS DISTINCT FROM
     (OLD.role, OLD.pin_digest, OLD.password_hash, OLD.active, OLD.branch_id, OLD.email) THEN
    DELETE FROM public.sessions WHERE account_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_session_invalidation AFTER UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION invalidate_changed_account_sessions();
