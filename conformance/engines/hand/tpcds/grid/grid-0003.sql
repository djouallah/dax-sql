SELECT ss_quantity, SUM(ss_ext_sales_price) AS a, SUM(ss_net_profit) AS b
FROM store_sales
GROUP BY ss_quantity
