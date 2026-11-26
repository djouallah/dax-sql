-- one row. Last year over every date: a sale whose date a year on is in the calendar (ALL of the
-- status and the color, or REMOVEFILTERS of store_sales, change nothing). m1: RANKX over every
-- brand; only the measures in the SWITCH take the brand's filter (context transition), its bare
-- aggregates stay those of the whole model. With these conditions the value is the brand's store
-- profit; the rank is one more than the brands whose value beats the whole model's (blank as 0)
WITH ly AS (
  SELECT SUM(ss.ss_ext_sales_price) AS r
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
), k AS (
  SELECT (SELECT COUNT(*) FROM stg_tpcds_archive_log) / NULLIF((SELECT SUM(row_count) FROM stg_tpcds_archive_log), 0) > 100 AS c1,
    (SELECT COUNT(DISTINCT cd_education_status) + MAX((cd_education_status IS NULL)::INT) FROM customer_demographics) < 100 AS c2,
    (SELECT COUNT(*) FROM catalog_sales) AS ncs,
    (SELECT SUM(cs_ext_sales_price) FROM catalog_sales) AS crev,
    (SELECT COUNT(*) FROM item) AS nit,
    (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS asr
), sb AS (
  SELECT i.i_brand, SUM(ss.ss_net_profit) AS np, COUNT(DISTINCT ss.ss_customer_sk) + MAX((ss.ss_customer_sk IS NULL)::INT) AS dc
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk GROUP BY ALL
), cb AS (
  SELECT i.i_brand, SUM(cs.cs_net_profit) AS np FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk GROUP BY ALL
), tot AS (
  SELECT (SELECT SUM(ss_net_profit) FROM store_sales) AS np,
    (SELECT COUNT(DISTINCT ss_customer_sk) + MAX((ss_customer_sk IS NULL)::INT) FROM store_sales) AS dc,
    (SELECT SUM(cs_net_profit) FROM catalog_sales) AS cnp
), v AS (
  -- the SWITCH, given a brand's (or the whole model's) store profit, distinct customers and catalog profit
  SELECT b.i_brand, CASE
      WHEN k.c1 THEN k.crev
      WHEN k.c2 THEN CASE WHEN k.ncs > 100 THEN sb.np WHEN COALESCE(sb.np, 0) < 100 THEN k.asr ELSE k.nit END
      ELSE CASE WHEN COALESCE(cb.np, 0) > 1000 THEN sb.dc ELSE k.ncs END END AS v
  FROM (SELECT DISTINCT i_brand FROM item) b CROSS JOIN k
  LEFT JOIN sb ON sb.i_brand IS NOT DISTINCT FROM b.i_brand
  LEFT JOIN cb ON cb.i_brand IS NOT DISTINCT FROM b.i_brand
), v0 AS (
  SELECT CASE
      WHEN k.c1 THEN k.crev
      WHEN k.c2 THEN CASE WHEN k.ncs > 100 THEN tot.np WHEN COALESCE(tot.np, 0) < 100 THEN k.asr ELSE k.nit END
      ELSE CASE WHEN COALESCE(tot.cnp, 0) > 1000 THEN tot.dc ELSE k.ncs END END AS v
  FROM k, tot
)
SELECT CASE WHEN (SELECT COUNT(*) FROM catalog_sales) > 0 THEN COALESCE(ly.r, 0) ELSE (SELECT MIN(ss_quantity) FROM store_sales) END AS m0,
  1 + (SELECT COUNT(*) FROM v WHERE COALESCE(v.v, 0) > COALESCE(v0.v, 0)) AS m1,
  ly.r AS m2
FROM ly, v0
