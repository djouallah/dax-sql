-- m0: the marital statuses (not filtered by the sales) over Store Revenue Same Period LY, a sale
-- counted in the month of its date a year on; m1: a price's items over the catalog profit of its
-- month (no store relationship to catalog_sales, so the same for every store name)
WITH ly AS (
  SELECT n.d_moy AS m, s.s_store_name AS sn, i.i_current_price AS p, SUM(ss.ss_ext_sales_price) AS r
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), cp AS (
  SELECT d.d_moy AS m, i.i_current_price AS p, SUM(cs.cs_net_profit) AS pr
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), ic AS (SELECT i_current_price AS p, COUNT(*) AS n FROM item GROUP BY ALL),
k AS (SELECT COUNT(DISTINCT cd_marital_status) + MAX((cd_marital_status IS NULL)::INT) AS n FROM customer_demographics),
t AS (
  SELECT g.d_moy, sn.s_store_name, pr.p, k.n / NULLIF(ly.r, 0) AS m0, ic.n / NULLIF(cp.pr, 0) AS m1
  FROM (SELECT DISTINCT d_moy FROM date_dim) g
  CROSS JOIN (SELECT DISTINCT s_store_name FROM store) sn
  CROSS JOIN (SELECT DISTINCT i_current_price AS p FROM item) pr
  CROSS JOIN k
  LEFT JOIN ly ON ly.m = g.d_moy AND ly.sn IS NOT DISTINCT FROM sn.s_store_name AND ly.p IS NOT DISTINCT FROM pr.p
  LEFT JOIN cp ON cp.m = g.d_moy AND cp.p IS NOT DISTINCT FROM pr.p
  LEFT JOIN ic ON ic.p IS NOT DISTINCT FROM pr.p
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
