-- per marital status, year and colour: the average February catalog quantity of all years (ALL(d_year)), so the same
-- in every year (the years crossed with the statuses and colours). A sale with no (or an unknown) date or
-- customer_demographics key makes that table's blank row: a blank year (ALL(d_year) lifts it too) or status.
WITH a AS (
  SELECT cd.cd_marital_status, i.i_color, AVG(cs.cs_quantity) AS m0
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_moy = 2
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT a.cd_marital_status, y.d_year, a.i_color, a.m0
FROM a CROSS JOIN (SELECT DISTINCT d_year FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))) y
WHERE a.m0 IS NOT NULL
