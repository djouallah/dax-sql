-- one row. m0: the average over quarter numbers of catalog quantity a year back (each date a year back, a month's
-- last day also its month's), over (catalog quantity year to date / the average store profit on the dates both a
-- year back from every date and in the last year to date: none, so blank). m1: the archive has files, so catalog
-- quantity a year back from every date. m2: 0 when (2 x smallest catalog profit + largest store sale) over store
-- revenue a year back is blank, else the brands (all, there being over 10 items)
WITH sh AS (
  SELECT d_date AS dt, d_qoy, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_date, d_qoy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk, d.d_date FROM sh JOIN date_dim d ON d.d_date = sh.ly
), lyq AS (
  SELECT DISTINCT sh.d_qoy, d.d_date_sk_1 AS sk FROM sh JOIN date_dim d ON d.d_date = sh.ly
), ytd AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS d0, MAX(d_date) AS d1 FROM date_dim
), x AS (
  SELECT ROUND(AVG(ss.ss_net_profit), 4) AS x
  FROM store_sales ss JOIN ly ON ly.sk = ss.ss_sold_date_sk, ytd WHERE ly.d_date BETWEEN ytd.d0 AND ytd.d1
), yq AS (
  SELECT SUM(cs.cs_quantity) AS q FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk, ytd
  WHERE d.d_date BETWEEN ytd.d0 AND ytd.d1
), aq AS (
  SELECT AVG(q) AS a FROM (SELECT lyq.d_qoy, SUM(cs.cs_quantity) AS q FROM catalog_sales cs JOIN lyq ON lyq.sk = cs.cs_sold_date_sk GROUP BY ALL)
), cly AS (
  SELECT SUM(cs_quantity) AS q FROM catalog_sales WHERE cs_sold_date_sk IN (SELECT sk FROM ly)
), r AS (
  SELECT CASE WHEN MIN(cs_net_profit) IS NULL AND (SELECT MAX(ss_ext_sales_price) FROM store_sales) IS NULL THEN NULL
              ELSE COALESCE(MIN(cs_net_profit), 0) * 2 + COALESCE((SELECT MAX(ss_ext_sales_price) FROM store_sales), 0) END
         / NULLIF((SELECT SUM(ss_ext_sales_price) FROM store_sales WHERE ss_sold_date_sk IN (SELECT sk FROM ly)), 0) AS r
  FROM catalog_sales
)
SELECT aq.a / NULLIF(yq.q / NULLIF(x.x, 0), 0) AS m0,
  CASE WHEN (SELECT COUNT(*) FROM stg_tpcds_archive_log) > 0 THEN cly.q ELSE (SELECT ROUND(AVG(cs_net_profit), 0) FROM catalog_sales) END AS m1,
  CASE WHEN r.r IS NULL THEN 0
       WHEN (SELECT COUNT(*) FROM item) > 10 THEN (SELECT COUNT(DISTINCT i_brand) + MAX(CASE WHEN i_brand IS NULL THEN 1 ELSE 0 END) FROM item) END AS m2
FROM aq, yq, x, cly, r
