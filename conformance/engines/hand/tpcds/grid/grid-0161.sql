WITH g AS (
  SELECT cs_catalog_page_sk, SUM(cs_ext_sales_price) AS m
  FROM catalog_sales GROUP BY cs_catalog_page_sk)
-- blank * 2 is blank, blank + 1 is 1
SELECT cs_catalog_page_sk, m * 2, COALESCE(m, 0) + 1, COALESCE(m, 0) FROM g
