-- catalog_sales is not filtered by store: every city has the overall average (a fixed decimal: four places)
WITH a AS (SELECT ROUND(AVG(cs_ext_sales_price), 4) AS a FROM catalog_sales)
SELECT DISTINCT c.s_city, a.a FROM store c, a WHERE a.a IS NOT NULL
QUALIFY RANK() OVER (ORDER BY a.a DESC) <= 3
