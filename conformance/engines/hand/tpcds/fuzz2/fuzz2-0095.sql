-- m1: under the group's state HASONEVALUE holds and the archive's rank among the states (all equal) is 1, so
-- every month x state is a group. m0: the least, over marital statuses, of the catalog revenue (navy and khaki
-- items; catalog_sales is not filtered by store) plus, past 1000 distinct store customers, the store profit
-- share of those colors in the month, state and status, else the catalog quantity on the month's dates a year back.
WITH ms AS (SELECT DISTINCT cd_marital_status FROM customer_demographics),
q AS (SELECT d_moy, d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim),
qly AS (SELECT d_moy, ly FROM q UNION SELECT d_moy, last_day(ly) FROM q WHERE dt = last_day(dt)),
cd AS (
  SELECT d.d_date AS dt, d.d_moy, cd.cd_marital_status, SUM(cs.cs_ext_sales_price) AS rev, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  WHERE i.i_color IN ('navy', 'khaki')
  GROUP BY ALL),
c AS (SELECT d_moy, cd_marital_status, SUM(rev) AS rev FROM cd GROUP BY ALL),
cl AS (
  SELECT qly.d_moy, cd.cd_marital_status, SUM(cd.qty) AS qty FROM qly JOIN cd ON cd.dt = qly.ly GROUP BY ALL),
s AS (
  SELECT d.d_moy, st.s_state, cd.cd_marital_status,
    COUNT(DISTINCT ss.ss_customer_sk) FILTER (WHERE i.i_color IN ('navy', 'khaki'))
      + (COUNT(*) FILTER (WHERE i.i_color IN ('navy', 'khaki') AND ss.ss_customer_sk IS NULL) > 0)::INT AS cust,
    SUM(ss.ss_net_profit) FILTER (WHERE i.i_color IN ('navy', 'khaki')) AS p, SUM(ss.ss_net_profit) AS pall
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN store st ON st.s_store_sk = ss.ss_store_sk LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL),
g AS (SELECT DISTINCT m.d_moy, st.s_state FROM date_dim m, store st),
v AS (
  SELECT g.d_moy, g.s_state, ms.cd_marital_status,
    c.rev, CASE WHEN COALESCE(s.cust, 0) > 1000 THEN s.p / NULLIF(s.pall, 0) ELSE cl.qty END AS x
  FROM g CROSS JOIN ms
  LEFT JOIN c ON c.d_moy = g.d_moy AND c.cd_marital_status IS NOT DISTINCT FROM ms.cd_marital_status
  LEFT JOIN cl ON cl.d_moy = g.d_moy AND cl.cd_marital_status IS NOT DISTINCT FROM ms.cd_marital_status
  LEFT JOIN s ON s.d_moy = g.d_moy AND s.s_state IS NOT DISTINCT FROM g.s_state AND s.cd_marital_status IS NOT DISTINCT FROM ms.cd_marital_status)
SELECT d_moy, s_state,
  MIN(CASE WHEN rev IS NULL AND x IS NULL THEN NULL ELSE COALESCE(rev, 0) + COALESCE(x, 0) END) AS m0, 1 AS m1
FROM v GROUP BY 1, 2
