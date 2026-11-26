SELECT i.i_category, SUM(ss.ss_ext_sales_price) AS revenue
FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
GROUP BY i.i_category
HAVING SUM(ss.ss_ext_sales_price) IS NOT NULL
