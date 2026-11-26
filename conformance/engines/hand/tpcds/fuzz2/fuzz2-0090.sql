-- catalog_sales is not filtered by store: every city has the overall average (a fixed decimal: four places);
-- sales of no store give store a blank row, one more (blank) city
WITH a AS (SELECT ROUND(AVG(cs_ext_sales_price), 4) AS a FROM catalog_sales)
SELECT c.s_city, a.a FROM (SELECT DISTINCT s_city FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) c, a WHERE a.a IS NOT NULL
QUALIFY RANK() OVER (ORDER BY a.a DESC) <= 3
