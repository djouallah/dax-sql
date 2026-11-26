-- a blank compares as 0
SELECT cs_catalog_page_sk, SUM(cs_quantity)
FROM catalog_sales
WHERE COALESCE(cs_catalog_page_sk, 0) <> 3 AND cs_promo_sk IS NOT NULL
GROUP BY cs_catalog_page_sk
