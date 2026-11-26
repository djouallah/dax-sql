SELECT SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE ss_list_price BETWEEN 1.49 AND 113.38
