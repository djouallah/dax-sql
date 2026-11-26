-- the grand total is the row with a blank cs_item_sk
SELECT cs_item_sk, SUM(cs_quantity)
FROM catalog_sales
GROUP BY ROLLUP (cs_item_sk)
ORDER BY cs_item_sk IS NULL, cs_item_sk, GROUPING(cs_item_sk)
