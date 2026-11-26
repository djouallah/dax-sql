-- per store city: the average catalog sales price, which no store filter reaches; sales of no store
-- give store a blank row, one more (blank) city
SELECT s_city, (SELECT ROUND(AVG(cs_ext_sales_price), 4) FROM catalog_sales) AS m0 -- a fixed decimal
FROM (SELECT DISTINCT s_city FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))
WHERE (SELECT COUNT(cs_ext_sales_price) FROM catalog_sales) > 0
