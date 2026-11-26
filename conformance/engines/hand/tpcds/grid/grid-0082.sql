SELECT SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE COALESCE(ss_item_sk, 0) < 9
