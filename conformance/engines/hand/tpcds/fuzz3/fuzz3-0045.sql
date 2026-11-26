-- RANKX over the education statuses: each one filters its own status, one distinct status is
-- never past 10, the count is blank for all: rank 1 for every state; the first 4 states ascending
SELECT s_state, 1 AS m0 FROM (SELECT DISTINCT s_state FROM store)
QUALIFY rank() OVER (ORDER BY s_state NULLS FIRST) <= 4
