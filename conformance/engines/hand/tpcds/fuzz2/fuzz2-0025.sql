-- per education status and item category (every pair: m2 is 0 since ship_mode is never one type):
-- store revenue in the calendar's last year rounded to a tenth, the lowest catalog profit, 0.
-- A sale with no or an unknown demographics or item is under the blank status or category
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), ss AS (
  SELECT cd.cd_education_status, i.i_category, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN w ON d.d_date BETWEEN w.y0 AND w.y1
  GROUP BY ALL
), cs AS (
  SELECT cd.cd_education_status, i.i_category, MIN(cs.cs_net_profit) AS lo
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT e.cd_education_status, c.i_category, ROUND(ss.rev, 1) AS m0, cs.lo AS m1, 0 AS m2
FROM (
  SELECT DISTINCT cd_education_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
      OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
) e
CROSS JOIN (
  -- item's blank row: an item key of a sale or a promotion it lacks, or a promotion's blank row
  SELECT DISTINCT i_category FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
) c
LEFT JOIN ss ON ss.cd_education_status IS NOT DISTINCT FROM e.cd_education_status AND ss.i_category IS NOT DISTINCT FROM c.i_category
LEFT JOIN cs ON cs.cd_education_status IS NOT DISTINCT FROM e.cd_education_status AND cs.i_category IS NOT DISTINCT FROM c.i_category
