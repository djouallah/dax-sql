SELECT i.i_class, SUM(cs.cs_ext_sales_price) AS m0
FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
GROUP BY 1
HAVING SUM(cs.cs_ext_sales_price) IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0) <= 3
