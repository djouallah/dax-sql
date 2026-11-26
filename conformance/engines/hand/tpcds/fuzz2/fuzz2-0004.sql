-- per education status: the rank, among the item brands, of the value over every brand, the value being
-- (store revenue YoY > 0 ? catalog quantity a year back : the status's lowest catalog price, over every brand) - catalog revenue rounded to cents;
-- with no date filter, "a year back" is every date whose next-year date is in the calendar. A sale with no
-- or an unknown demographics or item is under the blank status or brand (which ALL lists when it exists)
WITH ly AS (
  SELECT d_date_sk_1 FROM date_dim WHERE CAST(d_date + INTERVAL 1 YEAR AS DATE) IN (SELECT d_date FROM date_dim)
), ss AS (
  SELECT cd.cd_education_status AS e, i.i_brand AS b, GROUPING(i.i_brand) AS allb,
    SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE ss.ss_sold_date_sk IN (SELECT d_date_sk_1 FROM ly)) AS revly
  FROM store_sales ss
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY GROUPING SETS ((cd.cd_education_status, i.i_brand), (cd.cd_education_status))
), cs AS (
  SELECT cd.cd_education_status AS e, i.i_brand AS b, GROUPING(i.i_brand) AS allb,
    SUM(cs.cs_quantity) FILTER (WHERE cs.cs_sold_date_sk IN (SELECT d_date_sk_1 FROM ly)) AS qtyly,
    MIN(cs.cs_ext_sales_price) AS lo,
    ROUND(SUM(cs.cs_ext_sales_price), 2) AS rev
  FROM catalog_sales cs
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY GROUPING SETS ((cd.cd_education_status, i.i_brand), (cd.cd_education_status))
), es AS (
  SELECT DISTINCT cd_education_status AS e FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
      OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
), bs AS (
  -- item's blank row: an item key of a sale or a promotion it lacks, or a promotion's blank row
  SELECT DISTINCT i_brand AS b FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
), v AS (
  -- the value per status and brand (allb = 0) and per status over every brand (allb = 1)
  SELECT k.e, k.b, k.allb,
    CASE WHEN x.a IS NULL AND cs.rev IS NULL THEN NULL ELSE COALESCE(x.a, 0) - COALESCE(cs.rev, 0) END AS val
  FROM (SELECT e, b, 0 AS allb FROM es, bs UNION ALL SELECT e, NULL, 1 FROM es) k
  LEFT JOIN ss ON ss.e IS NOT DISTINCT FROM k.e AND ss.b IS NOT DISTINCT FROM k.b AND ss.allb = k.allb
  LEFT JOIN cs ON cs.e IS NOT DISTINCT FROM k.e AND cs.b IS NOT DISTINCT FROM k.b AND cs.allb = k.allb
  CROSS JOIN LATERAL (SELECT CASE WHEN (COALESCE(ss.rev, 0) - ss.revly) / NULLIF(ss.revly, 0) > 0 THEN cs.qtyly ELSE (SELECT c.lo FROM cs c WHERE c.e IS NOT DISTINCT FROM k.e AND c.allb = 1) END AS a) x
), r AS (
  SELECT o.e, 1 + COUNT(*) FILTER (WHERE COALESCE(b.val, 0) > COALESCE(o.val, 0)) AS rnk
  FROM v o JOIN v b ON b.e IS NOT DISTINCT FROM o.e AND b.allb = 0
  WHERE o.allb = 1
  GROUP BY o.e
)
SELECT e, rnk FROM r
QUALIFY RANK() OVER (ORDER BY rnk ASC) <= 4
