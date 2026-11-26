-- TOTALYTD with no date filter: the date table's last year. m0: AVERAGE (no context transition) is the
-- year's, the same for every promotion name. m1: the rank (skip, descending) of the total catalog profit
-- among the promotion names' (a blank as 0). m2: last year's dates, each date a year back (a month's last
-- day also reaching the shifted month's last).
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
ytd AS (
  SELECT ROUND(AVG(ss.ss_net_profit), 4) AS avgp, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, y
  WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx),
names AS (SELECT DISTINCT p_promo_name FROM promotion),
pp AS (
  SELECT p.p_promo_name, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk GROUP BY 1),
tot AS (SELECT SUM(cs_net_profit) AS np FROM catalog_sales),
rk AS (
  SELECT 1 + COUNT(*) FILTER (WHERE COALESCE(pp.np, 0) > COALESCE(tot.np, 0)) AS r
  FROM names LEFT JOIN pp ON pp.p_promo_name IS NOT DISTINCT FROM names.p_promo_name, tot),
ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
sply AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_date IN (SELECT dt FROM ly))
SELECT
  CASE WHEN COALESCE(ytd.avgp, 0) > 100 THEN (SELECT NULLIF(COUNT(*), 0) FROM names) END AS m0,
  CASE WHEN COALESCE(ytd.rev, 0) > 1000 THEN rk.r
    ELSE (SELECT COUNT(DISTINCT d_qoy) FROM date_dim) * (SELECT MIN(cs_ext_sales_price) FROM catalog_sales) END AS m1,
  CASE WHEN (SELECT COUNT(*) FROM stg_tpcds_archive_log) = 0 THEN 0 ELSE ROUND(sply.rev, 2) END AS m2
FROM ytd, rk, sply
