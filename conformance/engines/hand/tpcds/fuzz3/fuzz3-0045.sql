-- RANKX over the education statuses: each one filters its own status, one distinct status is
-- never past 10, the count is blank for all: rank 1 for every state (the blank row's too, when a store sale's
-- store is missing); the first 4 states ascending, blank first
WITH s AS (
  SELECT DISTINCT s_state FROM store
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)
)
SELECT s_state, 1 AS m0 FROM s
QUALIFY rank() OVER (ORDER BY s_state NULLS FIRST) <= 4
