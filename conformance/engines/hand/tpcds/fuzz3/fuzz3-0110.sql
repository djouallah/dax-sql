-- one row under marital status S or M and the two brands
WITH it AS (SELECT * FROM item WHERE i_brand IN ('scholaruniv #4', 'exportcorp #7')),
cd AS (SELECT * FROM customer_demographics WHERE cd_marital_status IN ('zz-none', 'S', 'M')),
c AS (
  SELECT SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs JOIN it ON it.i_item_sk = cs.cs_item_sk JOIN cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
), s AS (
  SELECT MAX(ss.ss_quantity) AS q,
    MAX(ss.ss_net_profit) FILTER (WHERE COALESCE(st.s_store_name, '') <> 'able' AND d.d_year IN (2024, 2026)) AS np
  FROM store_sales ss JOIN it ON it.i_item_sk = ss.ss_item_sk JOIN cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), one AS (SELECT COUNT(DISTINCT i_class) + MAX((i_class IS NULL)::INT) = 1 AS one FROM it),
city AS (SELECT LENGTH(LEFT(UPPER(STRING_AGG(COALESCE(s_city, ''), '|' ORDER BY s_city NULLS FIRST)), 5)) AS n FROM (SELECT DISTINCT s_city FROM store)),
promo AS (SELECT COUNT(DISTINCT p_promo_name) AS n FROM promotion WHERE p_promo_name = 'bar')
SELECT CASE WHEN COALESCE(c.q, 0) > 1 THEN CASE WHEN one.one THEN s.np END ELSE s.q END AS m0,
  city.n / NULLIF(NULLIF(promo.n, 0), 0) AS m1
FROM c, s, one, city, promo
