SELECT ss_cdemo_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE COALESCE(ss_item_sk, 0) <> 12
GROUP BY ss_cdemo_sk
