-- catalog_sales is not filtered by store: the December catalog profit for two ship types picks, per state,
-- the state's store count or twice the catalog revenue plus the state's store profit; then the greater of
-- that and the catalog profit (MAX of two: a blank compares as 0).
WITH cond AS (
  SELECT COALESCE(SUM(cs.cs_net_profit), 0) > 0 AS b
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  WHERE d.d_moy > 11 AND sm.sm_type IN ('TWO DAY', 'NEXT DAY')),
c AS (SELECT SUM(cs_ext_sales_price) AS rev, SUM(cs_net_profit) AS np FROM catalog_sales),
sp AS (
  SELECT st.s_state, SUM(ss.ss_net_profit) AS p
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk GROUP BY 1),
sc AS (SELECT s_state, COUNT(*) AS n FROM store GROUP BY 1),
x AS (
  SELECT sc.s_state,
    CASE WHEN cond.b THEN sc.n
      WHEN c.rev IS NULL AND sp.p IS NULL THEN NULL ELSE COALESCE(c.rev * 2, 0) + COALESCE(sp.p, 0) END AS a,
    c.np AS b
  FROM sc CROSS JOIN cond CROSS JOIN c LEFT JOIN sp ON sp.s_state IS NOT DISTINCT FROM sc.s_state)
SELECT s_state,
  CASE WHEN COALESCE(a, 0) > COALESCE(b, 0) THEN a WHEN COALESCE(b, 0) > COALESCE(a, 0) THEN b ELSE COALESCE(a, b) END AS m0
FROM x
