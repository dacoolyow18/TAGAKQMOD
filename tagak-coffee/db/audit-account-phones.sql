-- Read-only. Review account IDs privately and verify the number with each owner.
SELECT id, role, branch_id, phone, accounts_with_number
FROM (
  SELECT id, role, branch_id, phone, count(*) OVER (PARTITION BY phone) AS accounts_with_number
  FROM accounts
) reviewed
WHERE accounts_with_number > 1 OR phone !~ '^09[0-9]{9}$'
ORDER BY phone, id;
