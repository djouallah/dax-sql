-- a blank compares as 0
SELECT SUM(ss_ext_sales_price)
FROM store_sales
WHERE COALESCE(ss_ext_sales_price, 0) <> 481.4
