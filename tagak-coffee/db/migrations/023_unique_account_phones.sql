-- Prevent changes between the preflight and installation of both constraints.
LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  duplicate_groups integer;
  invalid_numbers integer;
BEGIN
  SELECT count(*) INTO duplicate_groups FROM (
    SELECT phone FROM accounts GROUP BY phone HAVING count(*) > 1
  ) duplicates;
  SELECT count(*) INTO invalid_numbers FROM accounts WHERE phone !~ '^09[0-9]{9}$';
  IF duplicate_groups > 0 OR invalid_numbers > 0 THEN
    RAISE EXCEPTION 'Phone validation migration paused: % duplicate phone groups, % invalid numbers. Review accounts using db/audit-account-phones.sql, correct verified numbers, then retry.', duplicate_groups, invalid_numbers;
  END IF;
END $$;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_phone_format CHECK (phone ~ '^09[0-9]{9}$'),
  ADD CONSTRAINT accounts_phone_key UNIQUE (phone);
