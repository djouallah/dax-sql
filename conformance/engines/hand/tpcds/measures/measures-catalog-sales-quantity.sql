SELECT cp.cp_type, SUM(cs.cs_quantity) AS quantity
FROM catalog_sales cs LEFT JOIN catalog_page cp ON cp.cp_catalog_page_sk = cs.cs_catalog_page_sk
GROUP BY cp.cp_type
HAVING SUM(cs.cs_quantity) IS NOT NULL
