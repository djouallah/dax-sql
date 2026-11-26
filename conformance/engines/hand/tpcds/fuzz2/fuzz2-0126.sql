-- every month but February (a sale with no date is kept: its blank month is not 2); per store name and promotion name (every pair: m1 is never blank).
-- m0: the smallest over marital statuses of distinct store customers, less |archive rows x smallest store sale|.
-- m1: the average over item prices of catalog revenue at the price when the archive has over 1000 files (it has 5),
-- else of the count of stores of the name; 2 x that + this year-to-date store revenue (from 1 January of the last such date's year) x catalog revenue
-- (the ship-address relationship changes nothing: no address filter).
-- A sale with no (or an unknown) store, promotion or customer_demographics key makes that table's blank row: a blank
-- store name (no store rows to count), promotion name or marital status, holding those sales.
WITH ytd AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS d0, MAX(d_date) AS d1 FROM date_dim WHERE d_moy <> 2
), s AS (
  SELECT st.s_store_name, p.p_promo_name, cd.cd_marital_status, ss.ss_customer_sk, ss.ss_ext_sales_price, d.d_date, d.d_moy
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
), dcm AS (
  SELECT s_store_name, p_promo_name, MIN(dc) AS dc FROM (
    SELECT s_store_name, p_promo_name, cd_marital_status,
      COUNT(DISTINCT ss_customer_sk) + MAX(CASE WHEN ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS dc
    FROM s WHERE d_moy IS DISTINCT FROM 2
    GROUP BY ALL)
  GROUP BY ALL
), sa AS (
  SELECT s_store_name, p_promo_name,
    MIN(ss_ext_sales_price) FILTER (WHERE d_moy IS DISTINCT FROM 2) AS mn,
    SUM(ss_ext_sales_price) FILTER (WHERE d_date BETWEEN ytd.d0 AND ytd.d1) AS ytd
  FROM s CROSS JOIN ytd GROUP BY ALL
), c AS (
  SELECT p.p_promo_name, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE d.d_moy IS DISTINCT FROM 2
  GROUP BY ALL
), cp AS (
  SELECT p_promo_name, ROUND(AVG(rev), 4) AS rev FROM (
    SELECT p.p_promo_name, i.i_current_price, SUM(cs.cs_ext_sales_price) AS rev
    FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
    LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk JOIN item i ON i.i_item_sk = cs.cs_item_sk
    WHERE d.d_moy IS DISTINCT FROM 2
    GROUP BY ALL)
  GROUP BY ALL
), n AS (
  SELECT s_store_name, COUNT(*) AS n FROM store GROUP BY ALL
  UNION ALL SELECT NULL, NULL
  WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
    AND NOT EXISTS (SELECT 1 FROM store WHERE s_store_name IS NULL)
)
SELECT n.s_store_name, p.p_promo_name,
  CASE WHEN dcm.dc IS NULL AND sa.mn IS NULL THEN NULL
       ELSE COALESCE(dcm.dc, 0) - COALESCE(ABS((SELECT SUM(row_count) FROM stg_tpcds_archive_log) * sa.mn), 0) END AS m0,
  CASE WHEN v.v IS NULL AND sa.ytd * c.rev IS NULL THEN NULL ELSE COALESCE(v.v, 0) * 2 + COALESCE(sa.ytd * c.rev, 0) END AS m1
FROM n CROSS JOIN (SELECT DISTINCT p_promo_name FROM promotion
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))) p
LEFT JOIN dcm ON dcm.s_store_name IS NOT DISTINCT FROM n.s_store_name AND dcm.p_promo_name IS NOT DISTINCT FROM p.p_promo_name
LEFT JOIN sa ON sa.s_store_name IS NOT DISTINCT FROM n.s_store_name AND sa.p_promo_name IS NOT DISTINCT FROM p.p_promo_name
LEFT JOIN c ON c.p_promo_name IS NOT DISTINCT FROM p.p_promo_name
LEFT JOIN cp ON cp.p_promo_name IS NOT DISTINCT FROM p.p_promo_name
CROSS JOIN LATERAL (SELECT CASE WHEN (SELECT COUNT(*) FROM stg_tpcds_archive_log) > 1000 THEN cp.rev ELSE n.n END AS v) v
