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
-- the groups: the months and categories crossed, with the blank month or category when a sale has no or an
-- unknown date or item (the blank month has no dates a year back: catalog quantity only)
SELECT m.d_moy, c.i_category, ROUND(COALESCE(cs.qty * 2, 0) + COALESCE(ss.rev, 0), 1) AS m0
FROM (
  SELECT DISTINCT d_moy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
) m
CROSS JOIN (
  -- item's blank row: an item key of a sale or a promotion it lacks, or a promotion's blank row
  SELECT DISTINCT i_category FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
) c
LEFT JOIN cs ON cs.d_moy IS NOT DISTINCT FROM m.d_moy AND cs.i_category IS NOT DISTINCT FROM c.i_category
LEFT JOIN ss ON ss.d_moy = m.d_moy AND ss.i_category IS NOT DISTINCT FROM c.i_category
WHERE cs.qty IS NOT NULL OR ss.rev IS NOT NULL
