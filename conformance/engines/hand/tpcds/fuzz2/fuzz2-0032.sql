-- per item category: catalog quantity / catalog revenue; the 3 highest, ties kept
SELECT i.i_category, SUM(cs.cs_quantity) / NULLIF(SUM(cs.cs_ext_sales_price), 0) AS m0
FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
GROUP BY i.i_category
HAVING m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 3
