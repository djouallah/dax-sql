SELECT d.i_current_price, SUM(ss_ext_sales_price) AS v
FROM store_sales ss LEFT JOIN item d ON ss.ss_item_sk = d.i_item_sk
GROUP BY d.i_current_price
