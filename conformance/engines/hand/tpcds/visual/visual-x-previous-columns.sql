WITH f AS (
  SELECT ss_store_sk, ss_sold_date_sk, SUM(ss_ext_sales_price) AS rev
  FROM store_sales
  WHERE ss_addr_sk IN (SELECT ca_address_sk FROM customer_address WHERE ca_state = 'AR')
    AND ss_cdemo_sk IN (SELECT cd_demo_sk FROM customer_demographics WHERE cd_education_status = '2 yr Degree')
  GROUP BY ALL
), g AS (
  SELECT s.s_store_name AS store, GROUPING(s.s_store_name) = 1 AS tr, d.d_year AS col, GROUPING(d.d_year) = 1 AS tc, SUM(f.rev) AS rev
  FROM f LEFT JOIN store s ON s.s_store_sk = f.ss_store_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = f.ss_sold_date_sk
  GROUP BY CUBE (s.s_store_name, d.d_year)
  HAVING SUM(f.rev) IS NOT NULL
), v AS (
  SELECT r.store, r.tr, c.col, c.tc, g.rev, g.rev IS NULL AS densified
  FROM (SELECT DISTINCT store, tr FROM g) r CROSS JOIN (SELECT DISTINCT col, tc FROM g) c
  LEFT JOIN g ON g.store IS NOT DISTINCT FROM r.store AND g.tr = r.tr AND g.col IS NOT DISTINCT FROM c.col AND g.tc = c.tc
)
SELECT LAG(rev) OVER (PARTITION BY store, tr, tc ORDER BY col NULLS FIRST) AS calc, store, tr, col, tc, rev, densified
FROM v
ORDER BY tr, store NULLS FIRST, tc, col NULLS FIRST
