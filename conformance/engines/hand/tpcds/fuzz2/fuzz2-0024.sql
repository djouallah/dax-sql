-- the lowest store sales price x 2 + all store revenue
SELECT MIN(ss_ext_sales_price) * 2 + SUM(ss_ext_sales_price) AS m0
FROM store_sales
HAVING COUNT(ss_ext_sales_price) > 0
