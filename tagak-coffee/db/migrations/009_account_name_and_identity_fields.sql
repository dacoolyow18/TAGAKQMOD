-- Split account names into distinct columns (first_name, middle_name, middle_initial, last_name)
-- and add birthdate alongside phone and email for identity verification.

ALTER TABLE accounts
  ADD COLUMN first_name text NOT NULL DEFAULT '',
  ADD COLUMN middle_name text NOT NULL DEFAULT '',
  ADD COLUMN middle_initial text NOT NULL DEFAULT '',
  ADD COLUMN last_name text NOT NULL DEFAULT '',
  ADD COLUMN birthdate text NOT NULL DEFAULT '';

WITH parts AS (
  SELECT id,
         role,
         regexp_split_to_array(trim(name), '\s+') AS tokens
    FROM accounts
   WHERE first_name = ''
)
UPDATE accounts a
   SET first_name = COALESCE(NULLIF(p.tokens[1], ''), 'Staff'),
       middle_name = CASE
         WHEN a.role IN ('Manager', 'Barista', 'Cashier') THEN
           CASE
             WHEN array_length(p.tokens, 1) >= 3 THEN p.tokens[2]
             ELSE 'M'
           END
         ELSE ''
       END,
       middle_initial = CASE
         WHEN a.role IN ('Super Admin', 'Admin') THEN
           CASE
             WHEN array_length(p.tokens, 1) >= 3 THEN left(regexp_replace(p.tokens[2], '\.', '', 'g'), 1)
             ELSE 'A'
           END
         ELSE ''
       END,
       last_name = CASE
         WHEN array_length(p.tokens, 1) >= 3 THEN array_to_string(p.tokens[3:array_length(p.tokens, 1)], ' ')
         WHEN array_length(p.tokens, 1) = 2 THEN p.tokens[2]
         ELSE COALESCE(NULLIF(p.tokens[1], ''), 'Account')
       END
  FROM parts p
 WHERE a.id = p.id;

UPDATE accounts
   SET email = lower(regexp_replace(id, '[^a-zA-Z0-9]', '', 'g')) || '@tagak.local'
 WHERE email IS NULL OR trim(email) = '';

UPDATE accounts
   SET phone = '09170000000'
 WHERE trim(phone) = '';

UPDATE accounts
   SET birthdate = '1995-01-01'
 WHERE trim(birthdate) = '';
