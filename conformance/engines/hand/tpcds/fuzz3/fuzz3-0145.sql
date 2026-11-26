-- one row over the items not "plum" (a blank color is not "plum"). m1: HASONEVALUE of their
-- class; its USERELATIONSHIP is on catalog_sales and does not touch the store sales
WITH it AS (SELECT * FROM item WHERE COALESCE(i_color, '') <> 'plum'),
s AS (
  SELECT COUNT(DISTINCT ss.ss_customer_sk) + MAX((ss.ss_customer_sk IS NULL)::INT) AS dc, SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_quantity) AS q, SUM(ss.ss_net_profit) FILTER (WHERE d.d_year = 2026) AS np26
  FROM store_sales ss JOIN it ON it.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), c AS (
  SELECT MAX(cs.cs_ext_sales_price) AS mx, MAX(cs.cs_quantity) AS mq
  FROM catalog_sales cs JOIN it ON it.i_item_sk = cs.cs_item_sk
), one AS (SELECT COUNT(DISTINCT i_class) + MAX((i_class IS NULL)::INT) = 1 AS one FROM it)
SELECT CASE WHEN ABS(COALESCE(s.dc, 0)) > 1 THEN
    CASE WHEN COALESCE((SELECT COUNT(*) FROM stg_tpcds_archive_log), 0) > 1000 OR c.mx IS NOT NULL THEN c.mq ELSE s.rev END
  ELSE (SELECT NULLIF(COUNT(*), 0) FROM (SELECT DISTINCT d_year FROM date_dim), (SELECT DISTINCT sm_type FROM ship_mode)) END AS m0,
  CASE WHEN one.one THEN s.np26 END AS m1,
  s.q AS m2
FROM s, c, one
