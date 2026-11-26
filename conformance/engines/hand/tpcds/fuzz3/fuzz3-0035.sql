-- the first 4 characters of the ship-mode types joined: their length, for every city
SELECT c.s_city, (SELECT length(left(upper(COALESCE(string_agg(COALESCE(sm_type, ''), '|' ORDER BY sm_type NULLS FIRST), '')), 4)) FROM (SELECT DISTINCT sm_type FROM ship_mode)) AS m0
FROM (SELECT DISTINCT s_city FROM store) c
