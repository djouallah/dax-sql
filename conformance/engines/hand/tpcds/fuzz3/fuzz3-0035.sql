-- the first 4 characters of the ship-mode types joined: their length, for every city. The cities and the
-- types include the blank rows' (sales of no store; catalog sales of no ship mode).
SELECT c.s_city,
  (SELECT length(left(upper(COALESCE(string_agg(COALESCE(sm_type, ''), '|' ORDER BY sm_type NULLS FIRST), '')), 4))
   FROM (SELECT DISTINCT sm_type FROM ship_mode
         UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL
                                           OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode)))) AS m0
FROM (SELECT DISTINCT s_city FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) c
