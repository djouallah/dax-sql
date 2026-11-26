-- a blank compares as 0
SELECT cs_catalog_page_sk, SUM(cs_ext_sales_price)
FROM catalog_sales
WHERE cs_quantity IN (32, 50) OR COALESCE(cs_sold_date_sk, 0) <> 2461399
GROUP BY cs_catalog_page_sk
