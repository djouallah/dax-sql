-- SUMMARIZE over catalog_sales: a group's context is its catalog_sales rows, which reach
-- store_sales only through the dimensions both share (item, promotion, billing address and
-- demographics, date): a store sale counts when its keys are those of one of the group's catalog
-- sales (a NULL key meets a NULL key: both are the dimension's blank row). m0: the stores are not filtered, every city joined by "," (a blank one too when sales of no store
-- give store a blank row). m1: 0 with no such store sale,
-- else the distinct customers of those keys in PARALLELPERIOD(-1 year) of the group's dates
WITH g AS (
  SELECT cd.cd_education_status, i.i_class, d.d_date, cs.*
  FROM catalog_sales cs
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
), grp AS (
  SELECT cd_education_status, i_class,
    date_trunc('year', MIN(d_date) - INTERVAL 1 YEAR)::DATE AS lo,
    (date_trunc('year', MAX(d_date) - INTERVAL 1 YEAR) + INTERVAL 1 YEAR - INTERVAL 1 DAY)::DATE AS hi
  FROM g GROUP BY ALL
), k5 AS (
  SELECT DISTINCT cd_education_status, i_class, cs_item_sk, cs_promo_sk, cs_bill_addr_sk, cs_bill_cdemo_sk, cs_sold_date_sk FROM g
), np AS (
  SELECT k.cd_education_status, k.i_class, SUM(ss.ss_net_profit) AS np
  FROM k5 k JOIN store_sales ss ON ss.ss_item_sk IS NOT DISTINCT FROM k.cs_item_sk
    AND ss.ss_promo_sk IS NOT DISTINCT FROM k.cs_promo_sk
    AND ss.ss_addr_sk IS NOT DISTINCT FROM k.cs_bill_addr_sk
    AND ss.ss_cdemo_sk IS NOT DISTINCT FROM k.cs_bill_cdemo_sk
    AND ss.ss_sold_date_sk IS NOT DISTINCT FROM k.cs_sold_date_sk
  GROUP BY ALL
), k4 AS (
  SELECT DISTINCT k.cd_education_status, k.i_class, cs_item_sk, cs_promo_sk, cs_bill_addr_sk, cs_bill_cdemo_sk
  FROM k5 k SEMI JOIN np ON np.cd_education_status IS NOT DISTINCT FROM k.cd_education_status AND np.i_class IS NOT DISTINCT FROM k.i_class
), dc AS (
  SELECT k.cd_education_status, k.i_class, COUNT(DISTINCT ss.ss_customer_sk) + MAX((ss.ss_customer_sk IS NULL)::INT) AS dc
  FROM k4 k
  JOIN grp ON grp.cd_education_status IS NOT DISTINCT FROM k.cd_education_status AND grp.i_class IS NOT DISTINCT FROM k.i_class
  JOIN store_sales ss ON ss.ss_item_sk IS NOT DISTINCT FROM k.cs_item_sk
    AND ss.ss_promo_sk IS NOT DISTINCT FROM k.cs_promo_sk
    AND ss.ss_addr_sk IS NOT DISTINCT FROM k.cs_bill_addr_sk
    AND ss.ss_cdemo_sk IS NOT DISTINCT FROM k.cs_bill_cdemo_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date BETWEEN grp.lo AND grp.hi
  GROUP BY ALL
)
SELECT grp.cd_education_status, grp.i_class,
  (SELECT SUM(LENGTH(COALESCE(s_city, ''))) + COUNT(*) - 1
   FROM (SELECT DISTINCT s_city FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))) AS m0,
  CASE WHEN np.np IS NULL THEN 0 ELSE dc.dc END AS m1
FROM grp
LEFT JOIN np ON np.cd_education_status IS NOT DISTINCT FROM grp.cd_education_status AND np.i_class IS NOT DISTINCT FROM grp.i_class
LEFT JOIN dc ON dc.cd_education_status IS NOT DISTINCT FROM grp.cd_education_status AND dc.i_class IS NOT DISTINCT FROM grp.i_class
