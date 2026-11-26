-- The years whose archive rows are not 0 (the archive is not filtered by dates): all of them, or none.
-- Then the promotion names whose store revenue for the group is past 1.
WITH yrs AS (
  SELECT DISTINCT d_year FROM date_dim
  WHERE (SELECT ABS(COALESCE(SUM(row_count), 0)) FROM stg_tpcds_archive_log) > 0),
s AS (
  SELECT cd.cd_marital_status, cd.cd_education_status, p.p_promo_name, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  WHERE d.d_year IN (SELECT d_year FROM yrs)
  GROUP BY ALL),
n AS (
  SELECT s.cd_marital_status, s.cd_education_status, NULLIF(COUNT(*) FILTER (WHERE s.rev > 1), 0) AS m0
  FROM (SELECT DISTINCT p_promo_name FROM promotion) names JOIN s ON s.p_promo_name IS NOT DISTINCT FROM names.p_promo_name
  GROUP BY ALL)
SELECT g.cd_marital_status, g.cd_education_status, n.m0
FROM (SELECT DISTINCT cd_marital_status, cd_education_status FROM customer_demographics WHERE COALESCE(cd_marital_status, '') <> 'S') g
JOIN n ON n.cd_marital_status IS NOT DISTINCT FROM g.cd_marital_status AND n.cd_education_status IS NOT DISTINCT FROM g.cd_education_status
WHERE n.m0 IS NOT NULL
