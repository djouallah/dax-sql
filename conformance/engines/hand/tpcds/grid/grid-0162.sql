WITH g AS (
  SELECT cs_catalog_page_sk, SUM(cs_ext_sales_price) AS n, SUM(cs_quantity) AS d
  FROM catalog_sales GROUP BY cs_catalog_page_sk)
SELECT cs_catalog_page_sk, n::DOUBLE / CASE WHEN d = 0 THEN NULL ELSE d END FROM g
