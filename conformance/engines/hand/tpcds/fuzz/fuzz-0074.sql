-- m0: no item filter to remove: the profit over itself; m2: RANKX of COUNTROWS, which no class
-- row changes (no CALCULATE): 1 for every group, so every pair of the dimensions is a group (each dimension's
-- blank value among them when the model has that blank row)
WITH f AS (
  SELECT cd.cd_education_status AS e, st.s_city AS c, SUM(ss.ss_net_profit) AS p, ABS(MAX(ss.ss_ext_sales_price)) AS mx
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_qoy = 4
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY 1, 2
), g AS (
  SELECT * FROM (SELECT cd_education_status AS e FROM customer_demographics
    UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
      OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)))
  CROSS JOIN (SELECT s_city AS c FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))
)
SELECT g.e, g.c, f.p / NULLIF(f.p, 0), f.mx, 1
FROM g LEFT JOIN f ON f.e IS NOT DISTINCT FROM g.e AND f.c IS NOT DISTINCT FROM g.c
