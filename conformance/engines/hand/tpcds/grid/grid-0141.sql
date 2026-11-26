SELECT i_item_sk, SUM(ss_ext_sales_price)
FROM store_sales JOIN item ON i_item_sk = ss_item_sk
GROUP BY i_item_sk
