-- customers other than single (a sale with no demographics kept: blank <> "S"), per month (all years) and
-- item category: catalog quantity x 2 + store revenue a year back, rounded to a tenth;
-- a month's dates a year back are those whose next-year date is in the calendar (the 29th of February too)
WITH cs AS (
  SELECT d.d_moy, i.i_category, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs
  LEFT JOIN customer_demographics x ON x.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE COALESCE(x.cd_marital_status, '') <> 'S'
  GROUP BY ALL
), ss AS (
  SELECT d.d_moy, i.i_category, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss
  LEFT JOIN customer_demographics x ON x.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE COALESCE(x.cd_marital_status, '') <> 'S'
    AND CAST(d.d_date + INTERVAL 1 YEAR AS DATE) IN (SELECT d_date FROM date_dim)
  GROUP BY ALL
)
-- the groups: the months and categories crossed (no blank month)
SELECT m.d_moy, c.i_category, ROUND(COALESCE(cs.qty * 2, 0) + COALESCE(ss.rev, 0), 1) AS m0
FROM (SELECT DISTINCT d_moy FROM date_dim) m
CROSS JOIN (SELECT DISTINCT i_category FROM item) c
LEFT JOIN cs ON cs.d_moy = m.d_moy AND cs.i_category IS NOT DISTINCT FROM c.i_category
LEFT JOIN ss ON ss.d_moy = m.d_moy AND ss.i_category IS NOT DISTINCT FROM c.i_category
WHERE cs.qty IS NOT NULL OR ss.rev IS NOT NULL
