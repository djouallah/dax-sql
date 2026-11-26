-- The years whose archive rows are not 0 (the archive is not filtered by dates): all of them, the blank year of
-- sales with no or an unknown date too, or none. Then the promotion names whose store revenue for the group is
-- past 1. A sale with no (or an unknown) customer_demographics key or promotion makes that table's blank row: a
-- blank status pair (its blank marital status is not "S") or a blank promotion name, counted.
WITH s AS (
  SELECT cd.cd_marital_status, cd.cd_education_status, p.p_promo_name, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  WHERE (SELECT ABS(COALESCE(SUM(row_count), 0)) FROM stg_tpcds_archive_log) > 0
  GROUP BY ALL),
names AS (
  SELECT DISTINCT p_promo_name FROM promotion
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))),
n AS (
  SELECT s.cd_marital_status, s.cd_education_status, NULLIF(COUNT(*) FILTER (WHERE s.rev > 1), 0) AS m0
  FROM names JOIN s ON s.p_promo_name IS NOT DISTINCT FROM names.p_promo_name
  GROUP BY ALL)
SELECT g.cd_marital_status, g.cd_education_status, n.m0
FROM (SELECT DISTINCT cd_marital_status, cd_education_status FROM customer_demographics WHERE COALESCE(cd_marital_status, '') <> 'S'
      UNION SELECT NULL, NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
        OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_ship_cdemo_sk IS NULL
          OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics) OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))) g
JOIN n ON n.cd_marital_status IS NOT DISTINCT FROM g.cd_marital_status AND n.cd_education_status IS NOT DISTINCT FROM g.cd_education_status
WHERE n.m0 IS NOT NULL
