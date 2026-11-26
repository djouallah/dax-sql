-- per store city: the average catalog sales price, which no store filter reaches
SELECT s_city, (SELECT ROUND(AVG(cs_ext_sales_price), 4) FROM catalog_sales) AS m0 -- a fixed decimal
FROM (SELECT DISTINCT s_city FROM store)
WHERE (SELECT COUNT(cs_ext_sales_price) FROM catalog_sales) > 0
