-- education other than "Unknown" (a sale with no demographics kept: blank <> "Unknown"), per item category and year:
-- m0: the top catalog profit / catalog profit
-- m1: the category's average store sales price Mar 22 2024 to Jun 30 2026 (the date filter replaces the year)
-- A sale with no or an unknown date or item is under the blank year or category
WITH cs AS (
  SELECT i.i_category, d.d_year, MAX(cs.cs_net_profit) / NULLIF(SUM(cs.cs_net_profit), 0) AS share
  FROM catalog_sales cs
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE COALESCE(cd.cd_education_status, '') <> 'Unknown'
  GROUP BY ALL
), ss AS (
  SELECT i.i_category, ROUND(AVG(ss.ss_ext_sales_price), 4) AS avgp
  FROM store_sales ss
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date BETWEEN DATE '2024-03-22' AND DATE '2026-06-30'
  WHERE COALESCE(cd.cd_education_status, '') <> 'Unknown'
  GROUP BY ALL
)
SELECT c.i_category, y.d_year, cs.share AS m0, ss.avgp AS m1
FROM (
  -- item's blank row: an item key of a sale or a promotion it lacks, or a promotion's blank row
  SELECT DISTINCT i_category FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
) c
CROSS JOIN (
  SELECT DISTINCT d_year FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
) y
LEFT JOIN cs ON cs.i_category IS NOT DISTINCT FROM c.i_category AND cs.d_year IS NOT DISTINCT FROM y.d_year
LEFT JOIN ss ON ss.i_category IS NOT DISTINCT FROM c.i_category
WHERE cs.share IS NOT NULL OR ss.avgp IS NOT NULL
