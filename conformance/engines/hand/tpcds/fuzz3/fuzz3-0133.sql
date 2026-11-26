-- PARALLELPERIOD(+1 year) of the whole calendar: its first year plus one to its last year plus
-- one, with the quarter filter beside it; AVERAGE of a fixed decimal rounded half away from zero
-- to 4 places
WITH rng AS (
  SELECT date_trunc('year', MIN(d_date) + INTERVAL 1 YEAR)::DATE AS lo,
         (date_trunc('year', MAX(d_date) + INTERVAL 1 YEAR) + INTERVAL 1 YEAR - INTERVAL 1 DAY)::DATE AS hi
  FROM date_dim
)
SELECT (SELECT COUNT(DISTINCT ca_state) + MAX((ca_state IS NULL)::INT) FROM customer_address) AS m0,
  (SELECT ROUND((SUM(cs.cs_net_profit) * 1000000)::HUGEINT // NULLIF(COUNT(cs.cs_net_profit), 0) * 0.000001, 4)
   FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk, rng
   WHERE d.d_date BETWEEN rng.lo AND rng.hi AND d.d_qoy NOT IN (2)) AS m1,
  (SELECT SUM(cs_net_profit) FROM catalog_sales) AS m2
